import { useMemo } from 'react';
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
  role: InstanceRole;
  /** The role was not reported, so the page assumed `facility`. */
  roleUnknown: boolean;
  facilityLocation?: { uuid: string; display?: string };
  etlCompletedAt?: string;
  etlStartedAt?: string;
  etlStatus?: string;
}

/**
 * Fails closed, as the backend does: anything but an explicit `central` is a facility. At a
 * facility the location is fixed, and if its UUID is unknown the request leaves `location` out,
 * which the backend defaults to, and clamps to, the facility (docs/reporting/README.md 3.2).
 */
export function toReportingContext(response?: ReportingContextResponse | null): ReportingContext {
  const reported = response?.instanceRole?.trim().toLowerCase();
  const role: InstanceRole = reported === 'central' ? 'central' : 'facility';
  return {
    role,
    roleUnknown: reported !== 'central' && reported !== 'facility',
    facilityLocation: role === 'facility' && response?.facilityLocation?.uuid ? response.facilityLocation : undefined,
    etlCompletedAt: response?.etlLastRun?.completedAt ?? undefined,
    etlStartedAt: response?.etlLastRun?.startedAt ?? undefined,
    etlStatus: response?.etlLastRun?.status ?? undefined,
  };
}

export function useReportingContext() {
  const { data, error, isLoading } = useSWR<{ data: ReportingContextResponse }>(reportingContextUrl, openmrsFetch, {
    // Freshness changes as the ETL runs; the role never does.
    refreshInterval: 5 * 60_000,
    shouldRetryOnError: false,
  });
  const context = useMemo(() => toReportingContext(data?.data), [data]);
  return { context, error, isLoading };
}
