import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

export type DecisionChoice = 'FACILITY_STANDS' | 'CENTRAL_REDONE_AT_FACILITY';

export interface Decision {
  decision: DecisionChoice;
  reason: string;
  decidedBy: string | null;
  dateDecided: number | null;
  dateApplied: number | null;
  applyError: string | null;
  dateApplyFailed: number | null;
}

export interface Conflict {
  id: number;
  table: string | null;
  identifier: string;
  raised: number | null;
  /** Later updates to the same record, held back behind this one. */
  waiting: number;
  decision: Decision | null;
  /** Other conflicts in the same table still to decide; the table is applied only once there are none. */
  undecidedInTable: number;
}

export interface AppliedDecision extends Decision {
  conflictId: number;
  table: string;
  identifier: string;
}

export interface SyncConflicts {
  /** False on a facility server, which has no receiver. */
  enabled: boolean;
  /** False when the EMR cannot read the receiver's queue. */
  available?: boolean;
  /** HH:MM-HH:MM in UTC; null when decisions are not applied automatically. */
  applyWindow?: string | null;
  conflicts?: Array<Conflict>;
  recent?: Array<AppliedDecision>;
}

export interface ConflictField {
  field: string;
  facility: string | null;
  central: string | null;
  /** False for a field with no matching column at central; shown, not compared. */
  compared: boolean;
  differs: boolean;
}

export interface ConflictDetail {
  id: number;
  table: string | null;
  identifier: string;
  raised: number | null;
  /** The code the sending server wrote; who to ask, not proof of who sent it. */
  facility: string | null;
  centralMissing: boolean;
  fields: Array<ConflictField>;
  decisions: Array<Decision>;
}

/** What openmrsFetch throws: an Error carrying the response, so the page can read its status. */
export type SyncConflictsError = Error & { response?: { status?: number } };

const baseUrl = `${restBaseUrl}/liberiaemr/syncconflicts`;

/** Often enough that a decision shows as applied soon after the receiver applies it. */
const refreshInterval = 30_000;

export function useSyncConflicts() {
  const { data, error, isLoading, mutate } = useSWR<{ data: SyncConflicts }, SyncConflictsError>(
    baseUrl,
    openmrsFetch,
    { refreshInterval },
  );
  return { conflicts: data?.data, error, isLoading, mutate };
}

export function useConflictDetail(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ data: ConflictDetail }, SyncConflictsError>(
    id === null ? null : `${baseUrl}/${id}`,
    openmrsFetch,
    { refreshInterval },
  );
  return { detail: data?.data, error, isLoading, mutate };
}

export function recordDecision(id: number, identifier: string, decision: DecisionChoice, reason: string) {
  return openmrsFetch<Decision>(`${baseUrl}/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { identifier, decision, reason },
  });
}
