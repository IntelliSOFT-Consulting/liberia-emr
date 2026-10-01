import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { getDefaultsFromConfigSchema, openmrsFetch, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { configSchema } from '../config-schema';
import { VIEW_PRIVILEGE } from '../privileges';
import routes from '../routes.json';
import AuditLog from './audit-log.component';
import AuditLogAppMenuItem from './audit-log-app-menu-item.component';
import { displayValue, exportUrl, listUrl, type AuditEntryDetail, type AuditPage } from './audit-log.resource';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;
const mockUseConfig = useConfig as jest.Mock;
const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

// Asserted through the words an auditor reads: t returns its default text.
jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name]));
  return { useTranslation: () => ({ t }) };
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function renderWithSwr(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const locationUpdate: AuditEntryDetail = {
  uuid: 'e-2',
  dateCreated: '2026-09-30T10:15:00.000+0000',
  action: 'UPDATED',
  type: 'org.openmrs.Location',
  typeName: 'Location',
  identifier: '7',
  user: { uuid: 'u-ict', username: 'ict.auditor', systemId: '12-3' },
  parentUuid: null,
  hasValues: true,
  childCount: 0,
  changes: [
    { property: 'description', previous: null, current: 'Outpatient wing', redacted: false },
    { property: 'name', previous: 'Ward A', current: 'Ward B', redacted: false },
  ],
  children: [],
};

const passwordGp: AuditEntryDetail = {
  uuid: 'e-1',
  dateCreated: '2026-09-30T09:00:00.000+0000',
  action: 'UPDATED',
  type: 'org.openmrs.GlobalProperty',
  typeName: 'Global Property',
  identifier: 'liberiaemr.email.password',
  user: null,
  parentUuid: null,
  hasValues: true,
  childCount: 0,
  changes: [{ property: 'propertyValue', previous: '[redacted]', current: '[redacted]', redacted: true }],
  children: [],
};

const deletedWard: AuditEntryDetail = {
  uuid: 'e-3',
  dateCreated: '2026-09-29T09:00:00.000+0000',
  action: 'DELETED',
  type: 'org.openmrs.Location',
  typeName: 'Location',
  identifier: '9',
  user: { uuid: 'u-admin', username: 'admin', systemId: 'admin' },
  parentUuid: null,
  hasValues: true,
  childCount: 1,
  lastState: [
    { property: 'name', value: 'Old Ward', redacted: false },
    { property: 'tags', value: ['tag-1', 'tag-2'], redacted: false },
  ],
  children: [
    {
      uuid: 'e-4',
      dateCreated: '2026-09-29T09:00:00.000+0000',
      action: 'DELETED',
      type: 'org.openmrs.LocationAttribute',
      typeName: 'Location Attribute',
      identifier: '11',
      user: null,
      parentUuid: 'e-3',
      hasValues: true,
      lastState: [{ property: 'valueReference', value: 'MFL-123', redacted: false }],
    },
  ],
};

const entries = [locationUpdate, passwordGp, deletedWard];

type Failure = { status: number; error: string };

function given({ privileged = true, list }: { privileged?: boolean; list?: Failure } = {}) {
  const calls: Array<string> = [];
  mockOpenmrsFetch.mockImplementation((url: string) => {
    calls.push(url);
    const path = url.split('?')[0];
    const fail = (failure: Failure) =>
      Promise.reject(
        Object.assign(new Error(failure.error), {
          response: { status: failure.status },
          responseBody: { error: failure.error },
        }),
      );
    if (path.endsWith('/auditlog/types')) {
      if (list) {
        return fail(list);
      }
      return Promise.resolve({
        data: {
          results: [
            { type: 'org.openmrs.GlobalProperty', name: 'Global Property' },
            { type: 'org.openmrs.Location', name: 'Location' },
          ],
        },
      });
    }
    if (path.endsWith('/auditlog')) {
      if (list) {
        return fail(list);
      }
      const params = new URLSearchParams(url.split('?')[1]);
      const start = Number(params.get('startIndex'));
      const limit = Number(params.get('limit'));
      const page: AuditPage = {
        totalCount: 120,
        startIndex: start,
        limit,
        results: entries
          .filter((entry) => !params.get('type') || entry.type === params.get('type'))
          .map(({ changes, lastState, children, ...summary }) => summary),
      };
      return Promise.resolve({ data: page });
    }
    const uuid = decodeURIComponent(path.split('/').pop());
    const entry = entries.find((candidate) => candidate.uuid === uuid);
    return entry ? Promise.resolve({ data: entry }) : fail({ status: 404, error: 'No audit log entry' });
  });
  mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema));
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileged && privilege === 'View Audit Log');
  return calls;
}

beforeEach(() => {
  mockOpenmrsFetch.mockReset();
});

describe('audit log menu entry', () => {
  it('is gated by View Audit Log in routes.json, the same privilege the component checks', () => {
    const extension = routes.extensions.find((candidate) => candidate.name === 'audit-log-app-menu-item');
    expect(extension.privileges).toEqual(['View Audit Log']);
    expect(VIEW_PRIVILEGE).toBe('View Audit Log');
  });

  it('shows the link to a holder of View Audit Log', () => {
    given();
    render(<AuditLogAppMenuItem />);
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/openmrs/spa/audit-log');
  });

  it('renders nothing for anyone else', () => {
    given({ privileged: false });
    const { container } = render(<AuditLogAppMenuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not declare the liberiaemr module as a backend dependency', () => {
    // CI and dev builds stamp liberiaemr 0.0.0-ci; a >=1.0.0 floor raises a toast on every page.
    expect(Object.keys(routes.backendDependencies)).toEqual(['webservices.rest']);
  });
});

describe('audit log page', () => {
  it('lists the newest entries with who, what and when, and the total', async () => {
    const calls = given();
    renderWithSwr(<AuditLog />);
    await settle();

    expect(screen.getByText('120 matching entries')).toBeInTheDocument();
    const rows = screen.getAllByTestId('audit-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Location')).toBeInTheDocument();
    expect(within(rows[0]).getByText('ict.auditor')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Updated')).toBeInTheDocument();
    expect(within(rows[1]).getByText('System')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Deleted')).toBeInTheDocument();
    expect(calls).toContain('/ws/rest/v1/liberiaemr/auditlog?startIndex=0&limit=50');
  });

  it('sends the filters to the server and starts again at the first page', async () => {
    const calls = given();
    renderWithSwr(<AuditLog />);
    await settle();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'ict.auditor' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'org.openmrs.Location' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'UPDATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await settle();

    expect(calls.at(-1)).toBe(
      '/ws/rest/v1/liberiaemr/auditlog?from=2026-09-01&to=2026-09-30&user=ict.auditor&type=org.openmrs.Location&action=UPDATED&startIndex=0&limit=50',
    );
    expect(screen.getByTestId('audit-export')).toHaveAttribute(
      'href',
      '/openmrs/ws/rest/v1/liberiaemr/auditlog/export?from=2026-09-01&to=2026-09-30&user=ict.auditor&type=org.openmrs.Location&action=UPDATED&limit=50000',
    );
  });

  it('shows only the new page’s entries once filters change the result', async () => {
    given();
    renderWithSwr(<AuditLog />);
    await settle();
    expect(screen.getAllByTestId('audit-row')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'org.openmrs.GlobalProperty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await settle();

    const rows = screen.getAllByTestId('audit-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('liberiaemr.email.password')).toBeInTheDocument();
  });

  it('pages on the server', async () => {
    const calls = given();
    renderWithSwr(<AuditLog />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await settle();
    expect(calls.at(-1)).toBe('/ws/rest/v1/liberiaemr/auditlog?startIndex=50&limit=50');
  });

  it('shows an update’s previous and new values', async () => {
    given();
    renderWithSwr(<AuditLog />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Open entry 7' }));
    await settle();

    const detail = screen.getByTestId('audit-detail');
    const changes = within(detail).getAllByTestId('audit-change');
    expect(within(changes[1]).getByText('name')).toBeInTheDocument();
    expect(within(changes[1]).getByText('Ward A')).toBeInTheDocument();
    expect(within(changes[1]).getByText('Ward B')).toBeInTheDocument();
    expect(within(changes[0]).getByText('(none)')).toBeInTheDocument();
    expect(within(detail).getByText('org.openmrs.Location')).toBeInTheDocument();
  });

  it('shows a redacted value as Redacted, never its text', async () => {
    given();
    renderWithSwr(<AuditLog />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Open entry liberiaemr.email.password' }));
    await settle();

    const detail = screen.getByTestId('audit-detail');
    expect(within(detail).getAllByText('Redacted')).toHaveLength(2);
    expect(within(detail).queryByText('[redacted]')).not.toBeInTheDocument();
  });

  it('shows a deleted item’s last state and the entries saved with it', async () => {
    given();
    renderWithSwr(<AuditLog />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Open entry 9' }));
    await settle();

    const detail = screen.getByTestId('audit-detail');
    expect(within(detail).getAllByText('Last state before deletion').length).toBeGreaterThan(0);
    expect(within(detail).getByText('Old Ward')).toBeInTheDocument();
    expect(within(detail).getByText('tag-1, tag-2')).toBeInTheDocument();
    expect(within(detail).getByText('Saved with it (1)')).toBeInTheDocument();
    expect(within(detail).getByText('MFL-123')).toBeInTheDocument();
  });

  it('tells a user without Get Audit Logs which role to ask for', async () => {
    given({ list: { status: 403, error: 'Get Audit Logs is required' } });
    renderWithSwr(<AuditLog />);
    await settle();

    expect(screen.getByText('You cannot read the audit log')).toBeInTheDocument();
    expect(screen.getByText(/ICT Auditor role/)).toBeInTheDocument();
    expect(screen.queryByTestId('audit-export')).not.toBeInTheDocument();
  });

  it('says so where the auditlog module is not running', async () => {
    given({ list: { status: 503, error: 'not installed' } });
    renderWithSwr(<AuditLog />);
    await settle();

    expect(screen.getByText('The audit log is not recorded on this server')).toBeInTheDocument();
  });
});

describe('audit log resource', () => {
  it('leaves empty filters out of the URL', () => {
    expect(listUrl({ from: '', user: '  ', action: '' }, 0, 25)).toBe(
      '/ws/rest/v1/liberiaemr/auditlog?startIndex=0&limit=25',
    );
    expect(exportUrl({ topLevelOnly: true }, 100)).toBe(
      '/openmrs/ws/rest/v1/liberiaemr/auditlog/export?topLevelOnly=true&limit=100',
    );
  });

  it('shows lists, maps and nothing as text', () => {
    expect(displayValue(['a', null, 'b'])).toBe('a, , b');
    expect(displayValue(null)).toBe('');
    expect(displayValue(12)).toBe('12');
    // A user's properties, as a login records them.
    expect(displayValue({ lastLoginTimestamp: '1790726360042', loginAttempts: '0', lockoutTimestamp: '' })).toBe(
      'lastLoginTimestamp: 1790726360042, loginAttempts: 0, lockoutTimestamp: ',
    );
  });
});
