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
 * - when the ETL last ran, from `_mamba_etl_schedule`.
 *
 * TODO(LE-335): the endpoint and its shape are this page's PROPOSAL to the reports module
 * subtask, which owns it; nothing serves it yet. Only this file changes if the module settles
 * on a different path or field names.
 */
export const reportingContextUrl = `${restBaseUrl}/liberiaemrreports/context`;

export interface ReportingContextResponse {
  /** `facility` or `central`, echoed from LIBERIAEMR_INSTANCE_ROLE after the backend's own fail-closed check. */
  instanceRole?: string;
  /** Resolved from liberiaemr.facility.locationUuid. Null at central. */
  facilityLocation?: { uuid: string; display?: string } | null;
  /** The last row of _mamba_etl_schedule. Null before the first run. */
  etlLastRun?: {
    startedAt?: string | null;
    completedAt?: string | null;
    /** Mamba's own status text, shown as is. */
    status?: string | null;
  } | null;
}

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
