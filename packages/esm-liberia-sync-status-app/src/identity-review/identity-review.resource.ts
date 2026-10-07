import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/** The one question a review asks: are these two records one person? */
export type ReviewDecisionChoice = 'SAME_PERSON' | 'DIFFERENT_PEOPLE';

export interface ReviewSummary {
  id: number;
  /** Why the matcher could not decide by itself. */
  reason: string;
  raised: number | null;
  /** Whether the two records are linked to one person right now. */
  linked: boolean;
  /** The facility each record came from, in the order of the records. */
  facilities: Array<string | null>;
}

export interface RecentDecision {
  id: number;
  raisedFor: string;
  decision: ReviewDecisionChoice;
  reason: string;
  decidedBy: string | null;
  dateDecided: number | null;
}

export interface IdentityReviews {
  /** False where there is no identity schema, which is every facility. */
  enabled: boolean;
  total?: number;
  reviews?: Array<ReviewSummary>;
  recent?: Array<RecentDecision>;
}

export interface ReviewRecord {
  patientUuid: string;
  missing?: boolean;
  name?: string | null;
  sex?: string | null;
  /** yyyy-mm-dd */
  birthdate?: string | null;
  birthdateEstimated?: boolean;
  nationalId?: string | null;
  identifiers?: Array<{ type: string; identifier: string }>;
  facility?: string | null;
  registered?: number | null;
  recordCode?: string | null;
  otherRecordsLinked?: number;
  voided?: boolean;
}

export interface ReviewDecision {
  decision: ReviewDecisionChoice;
  reason: string;
  decidedBy: string | null;
  dateDecided: number | null;
}

export interface ReviewDetail {
  id: number;
  status: 'OPEN' | 'DECIDED';
  reason: string;
  raised: number | null;
  linked: boolean;
  /** The record under review first, then the one it was matched against. */
  records: [ReviewRecord, ReviewRecord];
  decision: ReviewDecision | null;
}

export type IdentityReviewError = Error & { response?: { status?: number } };

const baseUrl = `${restBaseUrl}/liberiaemr/identity/reviews`;

const refreshInterval = 60_000;

export function useIdentityReviews() {
  const { data, error, isLoading, mutate } = useSWR<{ data: IdentityReviews }, IdentityReviewError>(
    baseUrl,
    openmrsFetch,
    { refreshInterval },
  );
  return { reviews: data?.data, error, isLoading, mutate };
}

export function useReviewDetail(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ data: ReviewDetail }, IdentityReviewError>(
    id === null ? null : `${baseUrl}/${id}`,
    openmrsFetch,
  );
  return { detail: data?.data, error, isLoading, mutate };
}

export function recordReviewDecision(id: number, decision: ReviewDecisionChoice, reason: string) {
  return openmrsFetch<ReviewDetail>(`${baseUrl}/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { decision, reason },
  });
}
