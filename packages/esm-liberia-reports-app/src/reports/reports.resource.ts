import { useMemo } from 'react';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import type { DataSetColumn } from './disaggregation';
import { type ReportFile, saveBlob, toReportBlob } from './report-file';

/**
 * Every call here is reportingrest 2.0.0, as verified in docs/reporting/README.md section 4.
 * Nothing else in reportingrest is used (section 4.3).
 */
const reportingrest = `${restBaseUrl}/reportingrest`;

export interface ReportParameter {
  name: string;
  type: string;
  label?: string;
}

export interface ReportDefinition {
  uuid: string;
  name: string;
  display?: string;
  /** Where the reports module writes each report's "not captured" disaggregation notes. */
  description?: string | null;
  parameters?: Array<ReportParameter>;
}

export interface ReportDesign {
  uuid: string;
  name: string;
  rendererType?: string;
  display?: string;
}

export type ReportRequestStatus =
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SCHEDULE_COMPLETED'
  | 'SAVED';

export interface ReportRequest {
  uuid: string;
  status: ReportRequestStatus;
  evaluateStartDatetime?: string | null;
  evaluateCompleteDatetime?: string | null;
  renderCompleteDatetime?: string | null;
}

export interface EvaluatedDataSet {
  metadata?: { columns?: Array<DataSetColumn> };
  rows?: Array<Record<string, unknown>>;
}

export interface RunParameters {
  startDate: string;
  endDate: string;
  /** Absent means national at central; at a facility the backend defaults it to the facility. */
  locationUuid?: string;
}

/** Stop polling on these (section 4.2). SAVED is a completed request that was kept. */
export function isFinished(status?: ReportRequestStatus) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'SAVED';
}

export function isSucceeded(status?: ReportRequestStatus) {
  return status === 'COMPLETED' || status === 'SAVED';
}

/** The configured MOH reports, in the configured order. Other report definitions are never shown. */
export function useLiberiaReports(reportUuids: Array<string>) {
  const { data, error, isLoading } = useSWRImmutable<{ data: { results: Array<ReportDefinition> } }>(
    reportUuids.length ? `${reportingrest}/reportDefinition?v=full` : null,
    openmrsFetch,
  );

  const reports = useMemo(() => {
    const byUuid = new Map((data?.data?.results ?? []).map((report) => [report.uuid, report]));
    return reportUuids.map((uuid) => byUuid.get(uuid)).filter(Boolean);
  }, [data, reportUuids]);

  return { reports, error, isLoading };
}

export function useReportDesigns(reportUuid?: string) {
  const { data, error, isLoading } = useSWRImmutable<{ data: { results: Array<ReportDesign> } }>(
    reportUuid ? `${reportingrest}/reportDesign?reportDefinitionUuid=${reportUuid}` : null,
    openmrsFetch,
  );
  return { designs: data?.data?.results ?? [], error, isLoading };
}

export type ExportFormat = 'csv' | 'xlsx';

/**
 * Finds a report's CSV or Excel design. reportingrest picks the rendering mode by the design's
 * UUID (section 4.1), so the design list is the source of truth; the renderer class decides which
 * is which, and the design name is the fallback.
 */
export function findDesign(designs: Array<ReportDesign>, format: ExportFormat): ReportDesign | undefined {
  const renderer = format === 'csv' ? /csv|delimited/i : /excel|xls/i;
  const name = format === 'csv' ? /\bcsv\b/i : /\b(excel|xlsx?)\b/i;
  return (
    designs.find((design) => renderer.test(design.rendererType ?? '')) ??
    designs.find((design) => name.test(design.name ?? design.display ?? ''))
  );
}

/** The POST body of section 4.1. Values are strings; reportingrest converts them to each parameter's type. */
export function buildReportRequest(reportUuid: string, designUuid: string, params: RunParameters) {
  const parameterMappings: Record<string, string> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };
  if (params.locationUuid) {
    parameterMappings.location = params.locationUuid;
  }
  return {
    status: 'REQUESTED',
    priority: 'NORMAL',
    reportDefinition: {
      parameterizable: { uuid: reportUuid },
      parameterMappings,
    },
    renderingMode: { argument: designUuid },
  };
}

export async function requestReport(reportUuid: string, designUuid: string, params: RunParameters) {
  const response = await openmrsFetch<ReportRequest>(`${reportingrest}/reportRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildReportRequest(reportUuid, designUuid, params),
  });
  return response.data;
}

/** Polls a request until it finishes. */
export function useReportRequest(requestUuid: string | undefined, pollIntervalMs: number) {
  const { data, error } = useSWR<{ data: ReportRequest }>(
    requestUuid ? `${reportingrest}/reportRequest/${requestUuid}` : null,
    openmrsFetch,
    {
      refreshInterval: (latest) => (isFinished(latest?.data?.status) ? 0 : pollIntervalMs),
      revalidateOnFocus: false,
    },
  );
  return { request: data?.data, error };
}

/** Cancels a queued or running request, or removes a finished one. */
export async function removeReportRequest(requestUuid: string) {
  await openmrsFetch(`${reportingrest}/reportRequest/${requestUuid}`, { method: 'DELETE' });
}

export function previewUrl(reportUuid: string, dataSetKey: string, params: RunParameters) {
  const query = new URLSearchParams({ startDate: params.startDate, endDate: params.endDate });
  if (params.locationUuid) {
    query.set('location', params.locationUuid);
  }
  return `${reportingrest}/reportDataSet/${reportUuid}/${dataSetKey}?${query}`;
}

/**
 * The on-screen view of a finished run. The CSV reportingrest renders carries column labels,
 * not the `<CODE>_<part>` names the view groups by, so the view evaluates the data set once more
 * through `reportDataSet`, with the same parameters.
 *
 * Keyed on the run's request UUID as well as the URL. The same report, period and location run
 * again after an ETL refresh must count again, not show the first run's figures. Within one
 * run it is immutable, so the figures stay those of that run.
 */
export function useReportPreview(
  run: { reportUuid: string; requestUuid: string; params: RunParameters } | undefined,
  dataSetKey: string,
) {
  const { data, error, isLoading } = useSWRImmutable<{ data: EvaluatedDataSet }, Error, [string, string] | null>(
    run ? [previewUrl(run.reportUuid, dataSetKey, run.params), run.requestUuid] : null,
    ([url]) => openmrsFetch<EvaluatedDataSet>(url),
  );
  return { dataSet: data?.data, error, isLoading };
}

/**
 * The privilege check in the components only hides the button. The server enforces it: the
 * reports module's `StoredReportAccessAdvice` (PR #169) requires Export National Report on
 * `ReportService.loadRenderedOutput`, `loadReportData` and `loadReport` for requests of its
 * reports, which is what `downloadReport` goes through, so a request UUID alone reads nothing.
 */
export async function downloadReport(requestUuid: string) {
  const { data } = await openmrsFetch<ReportFile>(
    `${reportingrest}/downloadReport?reportRequestUuid=${encodeURIComponent(requestUuid)}`,
  );
  saveBlob(toReportBlob(data), data.filename || 'report');
}
