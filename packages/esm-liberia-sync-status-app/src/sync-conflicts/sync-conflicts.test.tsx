import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import SyncConflicts from './sync-conflicts.component';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;

// Asserted through the words a reviewer reads, so t returns its default text with values filled in.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(values?.[name] ?? '')),
  }),
}));

// One answer per URL: the list and the conflict under review are separate requests.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    const answer = key ? (global as any).__swr[key] : undefined;
    return { data: answer?.data, error: answer?.error, isLoading: false, mutate: jest.fn() };
  },
}));

const listUrl = '/ws/rest/v1/liberiaemr/syncconflicts';
const person = '5b0f1c2e-0a3f-4a8e-9a55-3f1f7c0e2d11';

function given(url: string, answer: { data?: unknown; error?: unknown }) {
  (global as any).__swr[url] = answer;
}

function decision(overrides = {}) {
  return {
    decision: 'FACILITY_STANDS',
    reason: 'Agreed with the Careysburg records officer',
    decidedBy: 'reviewer',
    dateDecided: 1790000000000,
    dateApplied: null,
    applyError: null,
    dateApplyFailed: null,
    ...overrides,
  };
}

describe('sync conflicts page', () => {
  beforeEach(() => {
    (global as any).__swr = {};
    mockOpenmrsFetch.mockReset();
  });

  it('says what each conflict is waiting for', () => {
    given(listUrl, {
      data: {
        data: {
          enabled: true,
          available: true,
          applyWindow: '01:00-05:00',
          conflicts: [
            { id: 1, table: 'person', identifier: person, raised: 1790000000000, waiting: 1, decision: null, undecidedInTable: 0 },
            { id: 2, table: 'obs', identifier: 'o-1', raised: 1790000000000, waiting: 0, decision: decision(), undecidedInTable: 1 },
            { id: 3, table: 'visit', identifier: 'v-1', raised: 1790000000000, waiting: 0, decision: decision(), undecidedInTable: 0 },
          ],
          recent: [],
        },
      },
    });

    render(<SyncConflicts />);

    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText('Decided; waiting for 1 other conflict(s) in obs')).toBeInTheDocument();
    expect(screen.getByText('Decided; applied in the next window')).toBeInTheDocument();
    expect(screen.getByText(/Decisions are applied between 01:00-05:00 UTC/)).toBeInTheDocument();
  });

  it('tells a user without the privilege why', () => {
    given(listUrl, { error: Object.assign(new Error('Forbidden'), { response: { status: 403 } }) });

    render(<SyncConflicts />);

    expect(screen.getByText('You do not have permission to review sync conflicts')).toBeInTheDocument();
  });

  it('says so on a facility server, which has no receiver', () => {
    given(listUrl, { data: { data: { enabled: false } } });

    render(<SyncConflicts />);

    expect(screen.getByText('Sync conflicts are not available on this server')).toBeInTheDocument();
  });

  it('shows the fields that differ and records the decision for the record reviewed', async () => {
    given(listUrl, {
      data: {
        data: {
          enabled: true,
          available: true,
          applyWindow: '01:00-05:00',
          conflicts: [
            { id: 7, table: 'person', identifier: person, raised: 1790000000000, waiting: 1, decision: null, undecidedInTable: 0 },
          ],
          recent: [],
        },
      },
    });
    given(`${listUrl}/7`, {
      data: {
        data: {
          id: 7,
          table: 'person',
          identifier: person,
          raised: 1790000000000,
          facility: 'careysburg',
          centralMissing: false,
          fields: [
            { field: 'gender', facility: 'F', central: 'M', compared: true, differs: true },
            { field: 'birthdate', facility: '1990-04-01', central: '1990-04-01', compared: true, differs: false },
          ],
          decisions: [],
        },
      },
    });
    mockOpenmrsFetch.mockResolvedValue({ data: decision() });

    render(<SyncConflicts />);
    fireEvent.click(screen.getByText('Review'));

    expect(screen.getByText(/Sent by careysburg/)).toBeInTheDocument();
    expect(screen.getByText('gender')).toBeInTheDocument();
    expect(screen.queryByText('birthdate')).not.toBeInTheDocument();

    const record = screen.getByText('Record decision').closest('button');
    expect(record).toBeDisabled();

    fireEvent.click(screen.getByLabelText("The facility's version is right. Central's change is replaced."));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Agreed with the records officer  ' } });
    expect(record).toBeEnabled();
    fireEvent.click(record);

    await waitFor(() => expect(screen.getByText('Decision recorded')).toBeInTheDocument());
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(
      `${listUrl}/7/decision`,
      expect.objectContaining({
        method: 'POST',
        body: { identifier: person, decision: 'FACILITY_STANDS', reason: 'Agreed with the records officer' },
      }),
    );
  });
});
