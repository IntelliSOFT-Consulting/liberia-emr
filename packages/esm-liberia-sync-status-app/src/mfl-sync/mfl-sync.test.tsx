import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openmrsFetch, userHasAccess } from '@openmrs/esm-framework';
import MflSync from './mfl-sync.component';
import MflSyncAppMenuItem from './mfl-sync-app-menu-item.component';
import { type MflRun, type MflRunItemPage, type MflStatus } from './mfl-sync.types';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

// Asserted through the words an administrator reads, so t returns its default text with values filled in.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(values?.[name] ?? '')),
  }),
}));

// One answer per URL path; the query string (paging, filters) does not change the answer.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    const answer = key ? (global as any).__swr[key.split('?')[0]] : undefined;
    return { data: answer?.data, error: answer?.error, isLoading: false, mutate: jest.fn() };
  },
}));

const base = '/ws/rest/v1/liberiaemr/mfl';

function given(path: string, answer: { data?: unknown; error?: unknown }) {
  (global as any).__swr[`${base}${path}`] = answer;
}

function refusal(status: number, error?: string) {
  return Object.assign(new Error(String(status)), { response: { status }, responseBody: error ? { error } : undefined });
}

// The examples in docs/architecture/mfl-sync-api.md.
function run(overrides: Partial<MflRun> = {}): MflRun {
  return {
    id: 42,
    dryRun: false,
    trigger: 'SCHEDULE',
    status: 'SUCCEEDED',
    startedBy: null,
    started: 1790474400000,
    finished: 1790474431000,
    counts: { created: 0, updated: 3, retired: 0, unretired: 0, unchanged: 1107, failed: 0, warnings: 11 },
    message: null,
    ...overrides,
  };
}

function status(overrides: Partial<MflStatus> = {}): MflStatus {
  return {
    available: true,
    config: {
      enabled: true,
      url: 'https://dhis2.moh.gov.lr/mfl',
      username: 'an-api-user',
      schedule: { time: '02:00' },
    },
    nextRun: 1790560800000,
    running: null,
    lastRun: run(),
    lastSuccessfulRun: run(),
    held: { counties: 15, districts: 106, facilities: 996, retired: 2 },
    ...overrides,
  };
}

const items: MflRunItemPage = {
  results: [
    {
      action: 'UPDATE',
      level: 'FACILITY',
      mflUid: 'nY6mPgT0Kc6',
      mflCode: 'LBR-06-0624-06',
      locationUuid: '7dd5a981-7e3a-59fa-b1fa-e1474e299da8',
      name: 'Jah Clinic',
      changes: [{ field: 'name', from: ' Jah Clinic', to: 'Jah Clinic' }],
      warnings: [],
      error: null,
    },
    {
      action: 'WARNING',
      level: 'FACILITY',
      mflUid: 'aBcDeFgHiJ1',
      mflCode: null,
      locationUuid: '0f3d2c1b-0000-4000-8000-000000000001',
      name: 'Kesselee Memorial Health Center',
      changes: [],
      warnings: ['Facility Type: in Clinic and Health Center; Health Center wins'],
      error: null,
    },
    {
      action: 'ERROR',
      level: 'FACILITY',
      mflUid: 'AbCdEfGhIjK',
      mflCode: null,
      locationUuid: '0f3d2c1b-0000-4000-8000-000000000002',
      name: 'Careysburg Health Center',
      changes: [],
      warnings: [],
      error: "Not retired: this instance's own facility root. Decide by hand (ADR 0009 §5)",
    },
  ],
  totalCount: 3,
};

describe('MFL sync page', () => {
  beforeEach(() => {
    (global as any).__swr = {};
    mockOpenmrsFetch.mockReset();
    mockUserHasAccess.mockReset();
    mockUserHasAccess.mockReturnValue(true);
    given('/runs', { data: { data: { results: [run()], totalCount: 1 } } });
  });

  it('shows what is held, when it runs and what the last run did', () => {
    given('/status', { data: { data: status() } });

    render(<MflSync />);

    expect(screen.getByText('Daily at 02:00 (Monrovia time)')).toBeInTheDocument();
    expect(screen.getByText('an-api-user')).toBeInTheDocument();
    expect(screen.getByText('15 counties, 106 districts, 996 facilities (2 retired)')).toBeInTheDocument();
    expect(
      screen.getAllByText('0 created, 3 updated, 0 retired, 0 restored, 1107 unchanged, 0 failed, 11 with warnings'),
    ).toHaveLength(2);
  });

  it('never offers a password field', () => {
    given('/status', { data: { data: status() } });

    render(<MflSync />);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/a deployment secret that ICT sets on the server/)).toBeInTheDocument();
  });

  it('says so, and offers no run, where no MFL account is configured', () => {
    given('/status', { data: { data: status({ available: false, config: { ...status().config, username: null } }) } });

    render(<MflSync />);

    expect(screen.getByText('The MFL sync is not set up on this server')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dry run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('tells a user without View MFL Sync why, rather than blaming the server', () => {
    given('/status', { error: refusal(403) });

    render(<MflSync />);

    expect(screen.getByText('You do not have permission to view the MFL sync')).toBeInTheDocument();
  });

  it('shows but does not let a viewer without Manage MFL Sync change anything', () => {
    mockUserHasAccess.mockReturnValue(false);
    given('/status', { data: { data: status() } });

    render(<MflSync />);

    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('MFL address')).toBeDisabled();
  });

  it('starts a sync', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockResolvedValue({ data: run({ id: 43, status: 'RUNNING', trigger: 'MANUAL' }) });

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(screen.getByText('Sync started. This page updates as it runs.')).toBeInTheDocument());
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(
      `${base}/runs`,
      expect.objectContaining({ method: 'POST', body: { dryRun: false } }),
    );
  });

  it('starts a dry run', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockResolvedValue({ data: run({ id: 43, dryRun: true, status: 'RUNNING' }) });

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'Dry run' }));

    await waitFor(() => expect(screen.getByText(/Dry run started. It changes nothing/)).toBeInTheDocument());
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(`${base}/runs`, expect.objectContaining({ body: { dryRun: true } }));
  });

  it('explains a refused run when one is already in progress', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockRejectedValue(refusal(409, 'A run is already in progress'));

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(screen.getByText('A run is already in progress. Wait for it to finish.')).toBeInTheDocument());
  });

  it('holds the run buttons while a run is in progress', () => {
    given('/status', { data: { data: status({ running: run({ id: 44, status: 'RUNNING', finished: null }) }) } });

    render(<MflSync />);

    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.getByText(/Sync started/)).toBeInTheDocument();
  });

  it('reports a successful connection test', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockResolvedValue({ data: { ok: true, dhis2Version: '2.40.4.1', facilities: 996, message: null } });

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(screen.getByText('Connected to the MFL')).toBeInTheDocument());
    expect(screen.getByText('DHIS2 2.40.4.1, 996 facilities.')).toBeInTheDocument();
  });

  it('reports a failed connection test with the reason the server gave', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockResolvedValue({
      data: { ok: false, dhis2Version: null, facilities: null, message: '401 Unauthorized from the MFL: check the configured account' },
    });

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(screen.getByText('Could not connect to the MFL')).toBeInTheDocument());
    expect(screen.getByText('401 Unauthorized from the MFL: check the configured account')).toBeInTheDocument();
  });

  it('refuses an MFL address that ends in /api before sending it', () => {
    given('/status', { data: { data: status() } });

    render(<MflSync />);
    fireEvent.change(screen.getByLabelText('MFL address'), { target: { value: 'https://dhis2.moh.gov.lr/mfl/api' } });

    expect(screen.getByText('Use an https:// address that does not end in /api.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('saves only the settings that changed', async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockResolvedValue({ data: status({ config: { ...status().config, schedule: { time: '03:30' } } }) });

    render(<MflSync />);
    fireEvent.change(screen.getByLabelText('Daily run time (HH:MM, Monrovia time)'), { target: { value: '03:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(screen.getByText('Settings saved')).toBeInTheDocument());
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(
      `${base}/config`,
      expect.objectContaining({ method: 'PUT', body: { schedule: { time: '03:30' } } }),
    );
  });

  it("shows the server's reason when settings are refused", async () => {
    given('/status', { data: { data: status() } });
    mockOpenmrsFetch.mockRejectedValue(refusal(400, 'schedule.time must be HH:MM'));

    render(<MflSync />);
    fireEvent.change(screen.getByLabelText('Daily run time (HH:MM, Monrovia time)'), { target: { value: '04:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(screen.getByText('schedule.time must be HH:MM')).toBeInTheDocument());
  });

  it("opens a run's changes, warnings and errors", () => {
    given('/status', { data: { data: status() } });
    given('/runs/42', { data: { data: run() } });
    given('/runs/42/items', { data: { data: items } });

    render(<MflSync />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByText('Jah Clinic')).toBeInTheDocument();
    expect(screen.getByText('Jah Clinic →', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Facility Type: in Clinic and Health Center; Health Center wins')).toBeInTheDocument();
    expect(screen.getByText(/this instance's own facility root/)).toBeInTheDocument();
    expect(screen.getAllByText('Unchanged, with warnings').length).toBeGreaterThan(0);
  });
});

describe('MFL sync menu item', () => {
  beforeEach(() => {
    (global as any).__swr = {};
  });

  it('is absent where no MFL account is configured', () => {
    given('/status', { data: { data: status({ available: false }) } });

    render(<MflSyncAppMenuItem />);

    expect(screen.queryByText('Master Facility List sync')).not.toBeInTheDocument();
  });

  it('is absent for a user the status request refuses', () => {
    given('/status', { error: refusal(403) });

    render(<MflSyncAppMenuItem />);

    expect(screen.queryByText('Master Facility List sync')).not.toBeInTheDocument();
  });

  it('links to the page where the sync is set up', () => {
    given('/status', { data: { data: status() } });

    render(<MflSyncAppMenuItem />);

    expect(screen.getByText('Master Facility List sync')).toBeInTheDocument();
  });
});
