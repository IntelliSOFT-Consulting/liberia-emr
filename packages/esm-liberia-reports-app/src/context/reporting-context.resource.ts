import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/**
 * What the page needs to know about the server it runs on, which the browser cannot find out
 * for itself:
 *
 * - the instance role. `LIBERIAEMR_INSTANCE_ROLE` is a backend environment variable (ADR 0010
 *   decision 5), invisible to the browser. Frontend config cannot carry it either: the frontend
 *   image, and the config URLs baked into it, are the same at a facility and at central.
 * - the facility's own location, the `liberiaemr.facility.locationUuid` global property. Reading
 *   it through `systemsetting` would need Get Global Properties, which National Reporting
 *   Officer does not hold.
 * - when the ETL last ran, and how that run ended, from `_mamba_etl_schedule`.
 *
 * Served by the reports module (`ReportingContextController` and `ReportingContextService` in
 * modules/liberiaemrreports), which owns the path and the field names. Only this file changes
 * if they do.
 */
export const reportingContextUrl = `${restBaseUrl}/liberiaemrreports/context`;

export interface ReportingContextResponse {
  /** `facility` or `central`, echoed from LIBERIAEMR_INSTANCE_ROLE after the backend's own fail-closed check. */
  instanceRole?: string;
  /** Resolved from liberiaemr.facility.locationUuid. Null at central. */
  facilityLocation?: { uuid: string; display?: string } | null;
  /** The last row of _mamba_etl_schedule. Null before the first run. */
  etlLastRun?: {
    /**
     * SUCCESS and RUNNING rows carry their own times; a RUNNING row has `startedAt` and no
     * `completedAt` yet. For INTERRUPTED and ERROR they are not that run's: core rewrites a
     * stuck or failed row's times to the last successful run's.
     */
    startedAt?: string | null;
    completedAt?: string | null;
    /** One of SUCCESS, RUNNING, INTERRUPTED or ERROR (ReportingContextService.getEtlLastRun). */
    status?: string | null;
  } | null;
}

export type EtlStatus = 'SUCCESS' | 'RUNNING' | 'INTERRUPTED' | 'ERROR';

export type InstanceRole = 'facility' | 'central';

export interface ReportingContext {
  /** The context endpoint answered. Without it nothing is known, so the page runs no report. */
  available: boolean;
  role: InstanceRole;
  /** The role was not reported, so the page assumed `facility`. */
  roleUnknown: boolean;
  facilityLocation?: { uuid: string; display?: string };
  etlCompletedAt?: string;
  etlStartedAt?: string;
  etlStatus?: string;
}

/**
 * How far the report data can be trusted, from the last ETL run:
 *
 * - `current`: the last run succeeded, so its completion time is how fresh the figures are.
 * - `refreshing`: a run is in progress. The figures are those of the last completed run, if any.
 * - `failed`: the last run ended in ERROR or was INTERRUPTED. Its times are the last good run's,
 *   so no time is stated as current.
 * - `unknown`: a run is reported with no status, a status this page does not know, or SUCCESS
 *   with no completion time. Treated like a failure: no time is claimed.
 * - `never`: the ETL has not run here, or the context did not answer.
 */
export type EtlRefreshState = 'current' | 'refreshing' | 'failed' | 'unknown' | 'never';

export function etlRefreshState(context: ReportingContext): EtlRefreshState {
  const status = context.etlStatus?.trim().toUpperCase();
  if (!status) {
    return context.etlCompletedAt || context.etlStartedAt ? 'unknown' : 'never';
  }
  switch (status as EtlStatus) {
    case 'SUCCESS':
      return context.etlCompletedAt ? 'current' : 'unknown';
    case 'RUNNING':
      return 'refreshing';
    case 'ERROR':
    case 'INTERRUPTED':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Fails closed, as the backend does: anything but an explicit `central` is a facility, and a
 * facility reports on its own location only (docs/reporting/README.md 3.2).
 */
export function toReportingContext(response?: ReportingContextResponse | null): ReportingContext {
  const reported = response?.instanceRole?.trim().toLowerCase();
  const role: InstanceRole = reported === 'central' ? 'central' : 'facility';
  return {
    available: !!response,
    role,
    roleUnknown: reported !== 'central' && reported !== 'facility',
    facilityLocation: role === 'facility' && response?.facilityLocation?.uuid ? response.facilityLocation : undefined,
    etlCompletedAt: response?.etlLastRun?.completedAt ?? undefined,
    etlStartedAt: response?.etlLastRun?.startedAt ?? undefined,
    etlStatus: response?.etlLastRun?.status ?? undefined,
  };
}

/**
 * Whether the page knows which location a run reports on, so it can say so truthfully.
 *
 * - At central it always does: national, or the area the user chose.
 * - Anywhere else it needs the facility's own location UUID from the context.
 *
 * Without the context the role is unknown too. Leaving `location` out would then run a national
 * report on a central server while the page said "This facility". The backend's own fail-closed
 * clamp cannot help, because at central an absent location is legitimately national. So the
 * page does not run at all.
 */
export function isLocationKnown(context: ReportingContext) {
  return context.available && (context.role === 'central' || !!context.facilityLocation?.uuid);
}

export function useReportingContext() {
  const { data, error, isLoading, mutate } = useSWR<{ data: ReportingContextResponse }>(
    reportingContextUrl,
    openmrsFetch,
    {
      // Freshness changes as the ETL runs; the role never does.
      refreshInterval: 5 * 60_000,
      shouldRetryOnError: false,
    },
  );
  const context = useMemo(() => toReportingContext(data?.data), [data]);
  const retry = useCallback(() => mutate(), [mutate]);
  return { context, error, isLoading, retry };
}
