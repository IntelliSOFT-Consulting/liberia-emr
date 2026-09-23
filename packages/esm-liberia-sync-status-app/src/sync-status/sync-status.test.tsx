import React from 'react';
import { render, screen } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import SyncStatus from './sync-status.component';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;

// The page is asserted through the words an operator reads, so t returns its default text.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: (global as any).__swrData, error: (global as any).__swrError, isLoading: false }),
}));

function givenStatus(status: unknown) {
  (global as any).__swrData = { data: status };
  (global as any).__swrError = undefined;
}

function givenRefused() {
  (global as any).__swrData = undefined;
  (global as any).__swrError = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
}

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
});
