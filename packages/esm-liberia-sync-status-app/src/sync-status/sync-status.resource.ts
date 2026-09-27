import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

export interface FacilityStatus {
  code: string;
  recordsReceived: number;
  receivedLastDay: number;
  silent: boolean;
  certificateExpires: number | null;
}

export interface CentralStatus {
  recordsWaiting: number;
  recordsRetrying: number;
  conflicts: number;
  deadLetters: number;
  receiverUp: boolean;
  brokerUp: boolean;
}

export interface SyncStatus {
  /** False on a facility server, which has no national view to show. */
  enabled: boolean;
  /** False when central's monitoring cannot be reached; sync itself may be fine. */
  available?: boolean;
  facilities?: Array<FacilityStatus>;
  central?: CentralStatus;
  alerts?: Array<string>;
}

/** Refreshed on an interval because this is a wall board as much as a page. */
const refreshInterval = 60_000;

/** What openmrsFetch throws: an Error carrying the response, so the page can read its status. */
type SyncStatusError = Error & { response?: { status?: number } };

export function useSyncStatus() {
  const { data, error, isLoading } = useSWR<{ data: SyncStatus }, SyncStatusError>(
    `${restBaseUrl}/liberiaemr/syncstatus`,
    openmrsFetch,
    { refreshInterval },
  );

  return { status: data?.data, error, isLoading };
}

export interface IdentityStatus {
  /** False where there is no identity schema, which is every facility. */
  enabled: boolean;
  people?: number;
  records?: number;
  linked?: number;
  openReviews?: number;
  unassigned?: number;
}

export function useIdentityStatus() {
  const { data } = useSWR<{ data: IdentityStatus }, SyncStatusError>(
    `${restBaseUrl}/liberiaemr/identity/status`,
    openmrsFetch,
    { refreshInterval },
  );
  return { identity: data?.data };
}
