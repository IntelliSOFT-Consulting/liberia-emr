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
  waiting: number;
  decision: Decision | null;
  /** A table is applied only once every conflict in it is decided. */
  undecidedInTable: number;
}

export interface AppliedDecision extends Decision {
  conflictId: number;
  table: string;
  identifier: string;
}

export interface SyncConflicts {
  enabled: boolean;
  available?: boolean;
  /** HH:MM-HH:MM UTC; null when not applied automatically. */
  applyWindow?: string | null;
  conflicts?: Array<Conflict>;
  recent?: Array<AppliedDecision>;
}

export interface ConflictField {
  field: string;
  facility: string | null;
  central: string | null;
  compared: boolean;
  differs: boolean;
}

export interface ConflictDetail {
  id: number;
  table: string | null;
  identifier: string;
  raised: number | null;
  /** Claimed by the sender, not verified. */
  facility: string | null;
  centralMissing: boolean;
  fields: Array<ConflictField>;
  decisions: Array<Decision>;
}

export type SyncConflictsError = Error & { response?: { status?: number } };

const baseUrl = `${restBaseUrl}/liberiaemr/syncconflicts`;

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
