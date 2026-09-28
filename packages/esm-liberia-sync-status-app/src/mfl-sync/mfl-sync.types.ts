/**
 * The MFL sync REST contract, as types. docs/architecture/mfl-sync-api.md is the source of truth:
 * where the two disagree, the document wins and this file is changed to match it. Design:
 * docs/adr/0009-mfl-facility-locations.md.
 *
 * Base path: `${restBaseUrl}/liberiaemr/mfl`. Timestamps are epoch milliseconds. No type here has a
 * password field, and none must ever gain one.
 */

export type MflRunTrigger = 'SCHEDULE' | 'MANUAL';

export type MflRunStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

/** WARNING: unchanged, but with warnings. */
export type MflItemAction = 'CREATE' | 'UPDATE' | 'RETIRE' | 'UNRETIRE' | 'WARNING' | 'ERROR';

export type MflLevel = 'COUNTY' | 'DISTRICT' | 'FACILITY';

export interface MflSchedule {
  /** HH:MM, 24-hour, Africa/Monrovia. */
  time: string;
}

export interface MflConfig {
  enabled: boolean;
  /** The DHIS2 instance root, without /api. */
  url: string;
  /** From LIBERIAEMR_MFL_USERNAME; null when unset. Read-only. */
  username: string | null;
  schedule: MflSchedule;
}

/** PUT /config body. Partial; username is rejected. */
export interface MflConfigUpdate {
  enabled?: boolean;
  url?: string;
  schedule?: Partial<MflSchedule>;
}

export interface MflRunCounts {
  created: number;
  updated: number;
  retired: number;
  unretired: number;
  unchanged: number;
  failed: number;
  /** Items with at least one warning. */
  warnings: number;
}

/** Every run is a full pull (ADR 0009 §8). */
export interface MflRun {
  id: number;
  dryRun: boolean;
  trigger: MflRunTrigger;
  status: MflRunStatus;
  /** Username for a manual run, null for a scheduled one. */
  startedBy: string | null;
  started: number;
  finished: number | null;
  /** On a dry run, what would have happened. */
  counts: MflRunCounts;
  /** Why a run FAILED or is PARTIAL; null otherwise. */
  message: string | null;
}

export interface MflHeld {
  counties: number;
  districts: number;
  facilities: number;
  retired: number;
}

/** GET /status, and the response to PUT /config. */
export interface MflStatus {
  /** False where no MFL credentials are configured; the page hides itself. */
  available: boolean;
  config: MflConfig;
  /** Null when the schedule is disabled. */
  nextRun: number | null;
  running: MflRun | null;
  lastRun: MflRun | null;
  lastSuccessfulRun: MflRun | null;
  held: MflHeld;
}

/** POST /test-connection. A failed connection is still HTTP 200 with ok: false. */
export interface MflConnectionTest {
  ok: boolean;
  dhis2Version: string | null;
  facilities: number | null;
  message: string | null;
}

/** POST /runs body. */
export interface MflRunRequest {
  dryRun?: boolean;
}

export interface MflRunPage {
  results: Array<MflRun>;
  totalCount: number;
}

export interface MflFieldChange {
  /** name, parent, latitude, longitude, stateProvince, countyDistrict, tag:<name> or attribute:<type name>. */
  field: string;
  /** Null on CREATE. */
  from: string | null;
  to: string | null;
}

export interface MflRunItem {
  action: MflItemAction;
  level: MflLevel;
  mflUid: string;
  mflCode: string | null;
  /**
   * The OpenMRS location the item is about. `null` only on an `ERROR` item for a unit that has no
   * row here yet and could not be created (for example, its parent was missing from the pull).
   */
  locationUuid: string | null;
  name: string;
  changes: Array<MflFieldChange>;
  /** Group tie-breaks, out-of-bounds points, name disambiguation. */
  warnings: Array<string>;
  error: string | null;
}

export interface MflRunItemPage {
  results: Array<MflRunItem>;
  totalCount: number;
}

/** Every error response body. A 409 from POST /runs also carries the running run's id. */
export interface MflError {
  error: string;
  runId?: number;
}
