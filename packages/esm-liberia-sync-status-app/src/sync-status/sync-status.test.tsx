import React from 'react';
import { render, screen } from '@testing-library/react';
import { openmrsFetch, useSession, userHasAccess } from '@openmrs/esm-framework';
import SyncStatus from './sync-status.component';
import SyncStatusAppMenuItem from './sync-status-app-menu-item.component';
import routes from '../routes.json';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;
const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

// The page is asserted through the words an operator reads, so t returns its default text.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

// The status and the identity counts are separate requests; the identity one answers only when set.
// A null key is a request not sent; every key asked for is kept, so a test can say what was not.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) =>
    ((global as any).__swrKeys.push(key), key === null)
      ? { data: undefined, error: undefined, isLoading: false }
      : key.endsWith('/identity/status')
      ? { data: (global as any).__swrIdentity, error: undefined, isLoading: false }
      : key.endsWith('/mfl/status')
      ? { data: (global as any).__swrMfl, error: undefined, isLoading: false }
      : { data: (global as any).__swrData, error: (global as any).__swrError, isLoading: false },
}));

function givenStatus(status: unknown) {
  (global as any).__swrData = { data: status };
  (global as any).__swrError = undefined;
  (global as any).__swrIdentity = undefined;
  (global as any).__swrMfl = undefined;
}

function givenIdentity(identity: unknown) {
  (global as any).__swrIdentity = { data: identity };
}

function givenRefused() {
  (global as any).__swrData = undefined;
  (global as any).__swrError = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
}

/** Who reads the page: by default a Sync Administrator, holding every privilege it checks. */
function givenPrivileges(privileges: Array<string> = ['View Sync Status', 'View MFL Sync']) {
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileges.includes(privilege));
}

beforeEach(() => {
  (global as any).__swrKeys = [];
  givenPrivileges();
});

describe('sync status page', () => {
  beforeEach(() => {
    mockOpenmrsFetch.mockReset?.();
  });

  it('lists each facility and says which one has gone silent', () => {
    givenStatus({
      enabled: true,
      available: true,
      facilities: [
        { code: 'barnersville', recordsReceived: 0, receivedLastDay: 0, silent: true, certificateExpires: null },
        { code: 'careysburg', recordsReceived: 12, receivedLastDay: 5, silent: false, certificateExpires: 1790000000 },
        // Enrolled this week: nothing yet today, but too new for the three-day rule to mean anything.
        { code: 'bong', recordsReceived: 4, receivedLastDay: 0, silent: false, certificateExpires: 1790000000 },
      ],
      central: {
        recordsWaiting: 3,
        recordsRetrying: 2,
        conflicts: 1,
        deadLetters: 0,
        receiverUp: true,
        brokerUp: true,
      },
      alerts: [],
    });

    render(<SyncStatus />);

    expect(screen.getByText('careysburg')).toBeInTheDocument();
    expect(screen.getByText('barnersville')).toBeInTheDocument();
    expect(screen.getByText('Nothing for 3 days')).toBeInTheDocument();
    // Twice: the column heading, and careysburg's own tag.
    expect(screen.getAllByText('Sending')).toHaveLength(2);
    expect(screen.getByText('Nothing in the last day')).toBeInTheDocument();
    expect(screen.getByText('Records waiting to be applied')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('says which facilities have records that never reached central', () => {
    givenStatus({
      enabled: true,
      available: true,
      facilities: [
        {
          code: 'careysburg',
          recordsReceived: 12,
          receivedLastDay: 5,
          silent: false,
          certificateExpires: null,
          lastChecked: 1790300000,
          recordsMissing: 3,
        },
        {
          code: 'barnersville',
          recordsReceived: 9,
          receivedLastDay: 2,
          silent: false,
          certificateExpires: null,
          lastChecked: 1790300000,
          recordsMissing: 0,
        },
        { code: 'bong', recordsReceived: 4, receivedLastDay: 0, silent: false, certificateExpires: null },
      ],
      central: null,
      alerts: [],
    });

    render(<SyncStatus />);

    // The test renderer leaves {{count}} and {{date}} unfilled; the app fills them in.
    expect(screen.getByText(/missing at central$/)).toBeInTheDocument();
    expect(screen.getByText(/^All arrived/)).toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });

  it('says when each facility last sent, in a way a broker restart cannot reset', () => {
    const now = Math.floor(Date.now() / 1000);
    givenStatus({
      enabled: true,
      available: true,
      facilities: [
        {
          code: 'careysburg',
          // The broker restarted: its raw counter says 11, the week says 7577.
          recordsReceived: 11,
          receivedLastDay: 7577,
          receivedLastWeek: 7577,
          lastReceived: now - 12 * 60,
          silent: false,
          certificateExpires: null,
        },
        {
          code: 'bong',
          recordsReceived: 0,
          receivedLastDay: 0,
          receivedLastWeek: 0,
          lastReceived: null,
          silent: false,
          certificateExpires: null,
        },
      ],
      central: null,
      alerts: [],
    });

    render(<SyncStatus />);

    expect(screen.getByText('Last received')).toBeInTheDocument();
    expect(screen.getByText('12 minutes ago')).toBeInTheDocument();
    expect(screen.getByText('Not in the last 7 days')).toBeInTheDocument();
    expect(screen.getAllByText('7577')).toHaveLength(2);
    expect(screen.queryByText('Records received in total')).not.toBeInTheDocument();
    expect(screen.queryByText('11')).not.toBeInTheDocument();
  });

  it('says so on a facility server, where there is no national view', () => {
    givenStatus({ enabled: false });

    render(<SyncStatus />);

    expect(screen.getByText('Sync status is not available on this server')).toBeInTheDocument();
  });

  it('tells a user without the privilege why, rather than blaming the server', () => {
    givenRefused();

    render(<SyncStatus />);

    expect(screen.getByText('You do not have permission to see sync status')).toBeInTheDocument();
  });

  it('warns when monitoring cannot be reached, without claiming sync is broken', () => {
    givenStatus({ enabled: true, available: false });

    render(<SyncStatus />);

    expect(screen.getByText('Monitoring cannot be reached')).toBeInTheDocument();
  });

  it('shows the identity counts where central has an identity schema', () => {
    givenStatus({ enabled: true, available: true, facilities: [], central: null, alerts: [] });
    givenIdentity({ enabled: true, people: 40, records: 42, linked: 2, openReviews: 1, unassigned: 0 });

    render(<SyncStatus />);

    expect(screen.getByText('People identified')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Possible matches awaiting review')).toBeInTheDocument();
  });

  it('shows no identity section where there is no identity schema', () => {
    givenStatus({ enabled: true, available: true, facilities: [], central: null, alerts: [] });
    givenIdentity({ enabled: false });

    render(<SyncStatus />);

    expect(screen.queryByText('People identified')).not.toBeInTheDocument();
  });

  it('shows the alerts that are firing', () => {
    givenStatus({
      enabled: true,
      available: true,
      facilities: [],
      central: { recordsWaiting: 0, recordsRetrying: 0, conflicts: 0, deadLetters: 0, receiverUp: true, brokerUp: false },
      alerts: ['SyncFacilitySilent'],
    });

    render(<SyncStatus />);

    expect(screen.getByText('Alerts firing')).toBeInTheDocument();
    expect(screen.getByText('SyncFacilitySilent')).toBeInTheDocument();
  });

  it('links to the MFL sync only where it is set up', () => {
    givenStatus({ enabled: true, available: true, facilities: [], central: null, alerts: [] });
    (global as any).__swrMfl = { data: { available: false } };

    const { unmount } = render(<SyncStatus />);
    expect(screen.queryByText(/Master Facility List sync/)).not.toBeInTheDocument();
    unmount();

    (global as any).__swrMfl = { data: { available: true } };
    render(<SyncStatus />);
    expect(screen.getByText(/Master Facility List sync/)).toBeInTheDocument();
  });

  it('does not ask for the MFL status for a reader without View MFL Sync', () => {
    // The Sync Conflict Reviewer: View Sync Status, not View MFL Sync.
    givenPrivileges(['View Sync Status', 'Resolve Sync Conflicts']);
    givenStatus({ enabled: true, available: true, facilities: [], central: null, alerts: [] });
    (global as any).__swrMfl = { data: { available: true } };

    render(<SyncStatus />);

    expect(screen.queryByText(/Master Facility List sync/)).not.toBeInTheDocument();
    expect((global as any).__swrKeys.filter((key: string | null) => key?.endsWith('/mfl/status'))).toEqual([]);
  });
});

describe('sync status menu entry', () => {
  it('is gated by View Sync Status in routes.json, the privilege its endpoint requires', () => {
    const extension = routes.extensions.find((candidate) => candidate.name === 'sync-status-app-menu-item');
    expect(extension.privileges).toEqual(['View Sync Status']);
  });

  it('links to the page where the national view is on', () => {
    givenStatus({ enabled: true });
    render(<SyncStatusAppMenuItem />);
    expect(screen.getByRole('link', { name: 'Sync status' })).toHaveAttribute('href', '/openmrs/spa/sync-status');
  });

  it('is absent at a facility', () => {
    givenStatus({ enabled: false });
    const { container } = render(<SyncStatusAppMenuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends no request for a user without View Sync Status, who would only get a 403', () => {
    givenPrivileges([]);
    givenStatus({ enabled: true });
    const { container } = render(<SyncStatusAppMenuItem />);
    expect(container).toBeEmptyDOMElement();
    expect((global as any).__swrKeys).toEqual([null]);
  });
});
