import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

export interface FacilityStatus {
  code: string;
  recordsReceived: number;
  receivedLastDay: number;
  /** Across the past week; unlike recordsReceived it survives a broker restart. */
  receivedLastWeek?: number;
  /** When its records last arrived (epoch seconds); null when not in the past week. */
  lastReceived?: number | null;
  silent: boolean;
  certificateExpires: number | null;
  /** When the facility last sent its reconciliation digest; null until it has. */
  lastChecked?: number | null;
  /** Its records confirmed missing at central; null until it has been checked. */
  recordsMissing?: number | null;
}

export interface CentralStatus {
  recordsWaiting: number;
  recordsRetrying: number;
  conflicts: number;
  deadLetters: number;
  receiverUp: boolean;
  brokerUp: boolean;
}

/**
 * A facility's own sender, from its own monitoring. A value is null when the sender is not
 * reporting it, which is not the same as zero.
 */
export interface FacilitySenderStatus {
  senderRunning?: boolean | null;
  databaseReachable?: boolean | null;
  /** The sender's own check of its connection to the broker at central. */
  connectedToCentral?: boolean | null;
  /** Changes picked up but not yet sent. */
  recordsWaiting?: number | null;
  recordsRetrying?: number | null;
  /** True while the first load sends every record the facility already holds. */
  initialLoad?: boolean;
  /** When the last change the sender picked up was saved (epoch seconds). */
  lastCaptured?: number | null;
  captureStalledSeconds?: number | null;
}

export interface SyncStatus {
  /** The national view: false on a facility server, which shows its own sender instead. */
  enabled: boolean;
  /** False when central's monitoring cannot be reached; sync itself may be fine. */
  available?: boolean;
  facilities?: Array<FacilityStatus>;
  central?: CentralStatus;
  alerts?: Array<string>;
  /** Present on a facility server that runs sync: its own sender. */
  facility?: FacilitySenderStatus;
}

/** Refreshed on an interval because this is a wall board as much as a page. */
const refreshInterval = 60_000;

/** What openmrsFetch throws: an Error carrying the response, so the page can read its status. */
type SyncStatusError = Error & { response?: { status?: number } };

/** Not asked at all when `enabled` is false: a user without View Sync Status would only get a 403. */
export function useSyncStatus(enabled = true) {
  const { data, error, isLoading } = useSWR<{ data: SyncStatus }, SyncStatusError>(
    enabled ? `${restBaseUrl}/liberiaemr/syncstatus` : null,
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
