import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import IdentityReview from './identity-review.component';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;

// Asserted through the words a reviewer reads, so t returns its default text with values filled in.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(values?.[name] ?? '')),
  }),
}));

// One answer per URL: the list and the review open on the page are separate requests.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    const answer = key ? (global as any).__swr[key] : undefined;
    return { data: answer?.data, error: answer?.error, isLoading: false, mutate: jest.fn() };
  },
}));

const listUrl = '/ws/rest/v1/liberiaemr/identity/reviews';

function given(url: string, answer: { data?: unknown; error?: unknown }) {
  (global as any).__swr[url] = answer;
}

function record(overrides = {}) {
  return {
    patientUuid: 'a1',
    name: 'Mary Kollie',
    sex: 'F',
    birthdate: '1990-04-01',
    birthdateEstimated: false,
    nationalId: 'LR-1001',
    identifiers: [{ type: 'National ID', identifier: 'LR-1001' }],
    facility: 'Careysburg Health Center',
    registered: 1790000000000,
    recordCode: 'K7Q2-M4XP-9TRV',
    otherRecordsLinked: 0,
    voided: false,
    ...overrides,
  };
}

function detail(overrides = {}) {
  return {
    id: 7,
    status: 'OPEN',
    reason: 'National ID matches but sex differs',
    raised: 1790000000000,
    linked: false,
    records: [record(), record({ patientUuid: 'b2', sex: 'M', facility: 'Barnersville Clinic' })],
    decision: null,
    ...overrides,
  };
}

describe('identity review page', () => {
  beforeEach(() => {
    (global as any).__swr = {};
    mockOpenmrsFetch.mockReset();
  });

  it('lists the waiting matches with their facilities and why they need a person', () => {
    given(listUrl, {
      data: {
        data: {
          enabled: true,
          total: 1,
          reviews: [
            {
              id: 7,
              reason: 'National ID matches but sex differs',
              raised: 1790000000000,
              linked: false,
              facilities: ['Careysburg Health Center', 'Barnersville Clinic'],
            },
          ],
          recent: [],
        },
      },
    });

    render(<IdentityReview />);

    expect(screen.getByText('Careysburg Health Center / Barnersville Clinic')).toBeInTheDocument();
    expect(screen.getByText('National ID matches but sex differs')).toBeInTheDocument();
  });

  it('shows both records side by side and marks what differs', () => {
    given(listUrl, {
      data: {
        data: {
          enabled: true,
          total: 1,
          reviews: [{ id: 7, reason: 'National ID matches but sex differs', raised: null, linked: false, facilities: ['A', 'B'] }],
          recent: [],
        },
      },
    });
    given(`${listUrl}/7`, { data: { data: detail() } });

    render(<IdentityReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('Record under review')).toBeInTheDocument();
    expect(screen.getAllByText('Mary Kollie')).toHaveLength(2);
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('Sex').closest('tr').className).toMatch(/differs/);
    expect(screen.getByText('Name').closest('tr').className).not.toMatch(/differs/);
  });

  it('says what a decision will do before it is recorded, and records it with the reason', async () => {
    given(listUrl, {
      data: {
        data: {
          enabled: true,
          total: 1,
          reviews: [{ id: 7, reason: 'National ID changed after the record was linked', raised: null, linked: true, facilities: ['A', 'B'] }],
          recent: [],
        },
      },
    });
    given(`${listUrl}/7`, { data: { data: detail({ linked: true }) } });
    mockOpenmrsFetch.mockResolvedValue({ data: detail({ linked: false, status: 'DECIDED' }) });

    render(<IdentityReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByLabelText('No, different people'));

    expect(screen.getByText(/The record from Careysburg Health Center is separated from this person/)).toBeInTheDocument();
    const record = screen.getByRole('button', { name: 'Record decision' });
    expect(record).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Mother and daughter, checked with the records officer' } });
    fireEvent.click(record);

    await waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalled());
    const [url, init] = mockOpenmrsFetch.mock.calls[0];
    expect(url).toBe(`${listUrl}/7/decision`);
    expect(init.body).toEqual({ decision: 'DIFFERENT_PEOPLE', reason: 'Mother and daughter, checked with the records officer' });
    await waitFor(() => expect(screen.getByText('The two records are kept as different people.')).toBeInTheDocument());
  });

  it('tells a reviewer when someone else decided first', async () => {
    given(listUrl, {
      data: { data: { enabled: true, total: 1, reviews: [{ id: 7, reason: 'r', raised: null, linked: false, facilities: [] }], recent: [] } },
    });
    given(`${listUrl}/7`, { data: { data: detail() } });
    mockOpenmrsFetch.mockRejectedValue({ response: { status: 409 } });

    render(<IdentityReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByLabelText('Yes, the same person'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Same card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    await waitFor(() => expect(screen.getByText(/Someone else decided this review/)).toBeInTheDocument());
  });

  it('tells a user without the privilege why', () => {
    given(listUrl, { error: { response: { status: 403 } } });

    render(<IdentityReview />);

    expect(screen.getByText('You do not have permission to review possible matches')).toBeInTheDocument();
  });

  it('says so at a facility, where there is no identity service', () => {
    given(listUrl, { data: { data: { enabled: false } } });

    render(<IdentityReview />);

    expect(screen.getByText('Identity review is not available on this server')).toBeInTheDocument();
  });
});
