import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ButtonSet,
  InlineLoading,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Tag,
} from '@carbon/react';
import { useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type ReportsConfig } from '../config-schema';
import { EXPORT_PRIVILEGE } from '../privileges';
import { useReportingContext } from '../context/reporting-context.resource';
import Freshness from '../context/freshness.component';
import LocationPicker, { type ReportLocation } from '../location/location-picker.component';
import { monthlyPeriods, quarterlyPeriods, type PeriodType } from './periods';
import ReportResults from './report-results.component';
import {
  downloadReport,
  type ExportFormat,
  findDesign,
  isFinished,
  isSucceeded,
  removeReportRequest,
  requestReport,
  type RunParameters,
  useLiberiaReports,
  useReportDesigns,
  useReportPreview,
  useReportRequest,
} from './reports.resource';
import styles from './reports.scss';

interface Run {
  reportUuid: string;
  requestUuid: string;
  params: RunParameters;
  locationName: string;
  periodLabel: string;
}

/**
 * Choose a report, a period and a location; run it; follow its status; read the result by
 * disaggregation; export it as CSV or Excel. Every call is reportingrest (docs/reporting/README.md 4).
 */
const ReportRunner: React.FC = () => {
  const { t } = useTranslation();
  const config = useConfig<ReportsConfig>();
  const session = useSession();
  const permitted = !!session?.user && userHasAccess(EXPORT_PRIVILEGE, session.user);

  if (!permitted) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('notPermitted', 'You do not have permission to run national reports')}
          subtitle={t('askForPrivilege', 'Ask ICT for the National Reporting Officer role.')}
        />
      </div>
    );
  }

  return <PermittedReportRunner config={config} />;
};

const PermittedReportRunner: React.FC<{ config: ReportsConfig }> = ({ config }) => {
  const { t } = useTranslation();
  const { context, error: contextError, isLoading: contextLoading } = useReportingContext();
  const { reports, error: reportsError, isLoading: reportsLoading } = useLiberiaReports(config.reportUuids);

  const [reportUuid, setReportUuid] = useState('');
  const report = reports.find((r) => r.uuid === reportUuid) ?? reports[0];
  const { designs, isLoading: designsLoading } = useReportDesigns(report?.uuid);

  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const periods = useMemo(
    () =>
      periodType === 'month'
        ? monthlyPeriods(new Date(), config.monthsOffered)
        : quarterlyPeriods(new Date(), config.quartersOffered),
    [periodType, config.monthsOffered, config.quartersOffered],
  );
  const [periodId, setPeriodId] = useState('');
  // Default to the last complete period: the current one is still filling up.
  const period = periods.find((p) => p.id === periodId) ?? periods[1] ?? periods[0];

  const [location, setLocation] = useState<ReportLocation>();
  const onLocationChange = useCallback((next: ReportLocation) => setLocation(next), []);

  const [run, setRun] = useState<Run>();
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState<string>();
  const { request, error: pollError } = useReportRequest(run?.requestUuid, config.pollIntervalMs);
  const status = request?.status;
  const succeeded = isSucceeded(status);
  const { dataSet, error: previewError, isLoading: previewLoading } = useReportPreview(
    succeeded ? run?.reportUuid : undefined,
    config.dataSetKey,
    run?.params,
  );

  const [exporting, setExporting] = useState<{ format: ExportFormat; requestUuid?: string }>();
  const { request: exportRequest, error: exportPollError } = useReportRequest(
    exporting?.requestUuid,
    config.pollIntervalMs,
  );
  const [exportError, setExportError] = useState<string>();

  // A run, and every export of it, belongs to one generation. Clearing the run (a new run, a
  // cancel, or another report) starts the next, so a request that answers late is recognised as
  // stale and dropped instead of landing on whatever is selected by then.
  const generation = useRef(0);
  // Set before anything is awaited: a second click that arrives before React has re-rendered the
  // disabled buttons must not start a second export.
  const exportInFlight = useRef(false);

  // Every run is rendered with the CSV design, so "Download CSV" hands back the run's own output.
  // A report without one cannot be run: no other design is ever used in its place.
  const csvDesign = findDesign(designs, 'csv');
  const xlsxDesign = findDesign(designs, 'xlsx');

  const clearRun = () => {
    generation.current += 1;
    exportInFlight.current = false;
    setRun(undefined);
    setExporting(undefined);
    setRunError(undefined);
    setExportError(undefined);
  };

  /** Leaves the current run for another report, and stops its work on the server if it is still going. */
  const abandonRun = () => {
    if (run && !isFinished(status)) {
      discardRequest(run.requestUuid);
    }
    if (exporting?.requestUuid && !isFinished(exportRequest?.status)) {
      discardRequest(exporting.requestUuid);
    }
    clearRun();
  };

  const runReport = async () => {
    if (!report || !period || !location || !csvDesign) {
      return;
    }
    clearRun();
    const current = generation.current;
    setSubmitting(true);
    const params: RunParameters = {
      startDate: period.startDate,
      endDate: period.endDate,
      locationUuid: location.level === 'national' ? undefined : location.uuid,
    };
    try {
      const created = await requestReport(report.uuid, csvDesign.uuid, params);
      if (generation.current !== current) {
        // Another report was chosen while this one was being submitted.
        discardRequest(created.uuid);
        return;
      }
      setRun({
        reportUuid: report.uuid,
        requestUuid: created.uuid,
        params,
        locationName: location.name,
        periodLabel: period.label,
      });
    } catch (e) {
      if (generation.current === current) {
        setRunError(errorText(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRun = async () => {
    if (run && !isFinished(status)) {
      try {
        await removeReportRequest(run.requestUuid);
      } catch (e) {
        setRunError(errorText(e));
        return;
      }
    }
    clearRun();
  };

  /** Ends an export of the given generation, unless the run it belonged to has been left since. */
  const finishExport = (current: number, error?: string) => {
    if (generation.current !== current) {
      return;
    }
    exportInFlight.current = false;
    setExporting(undefined);
    if (error) {
      setExportError(error);
    }
  };

  const exportAs = async (format: ExportFormat) => {
    const design = format === 'csv' ? csvDesign : xlsxDesign;
    if (!run || !design || exportInFlight.current) {
      return;
    }
    const current = generation.current;
    exportInFlight.current = true;
    setExporting({ format });
    setExportError(undefined);

    if (format === 'csv') {
      // The run itself rendered CSV; nothing to evaluate again.
      try {
        await downloadReport(run.requestUuid);
        finishExport(current);
      } catch (e) {
        finishExport(current, errorText(e));
      }
      return;
    }

    try {
      const created = await requestReport(run.reportUuid, design.uuid, run.params);
      if (generation.current !== current) {
        discardRequest(created.uuid);
        return;
      }
      setExporting({ format, requestUuid: created.uuid });
    } catch (e) {
      finishExport(current, errorText(e));
    }
  };

  // An Excel export is a second request with the Excel design; download it once it has rendered.
  const downloaded = useRef<string>();
  useEffect(() => {
    const uuid = exporting?.requestUuid;
    if (!uuid || downloaded.current === uuid) {
      return;
    }
    const current = generation.current;
    if (exportPollError) {
      // Its status cannot be read, so it may never be seen to finish: stop waiting for it.
      downloaded.current = uuid;
      finishExport(current, errorText(exportPollError));
      return;
    }
    if (!isFinished(exportRequest?.status)) {
      return;
    }
    downloaded.current = uuid;
    if (!isSucceeded(exportRequest.status)) {
      finishExport(current, t('exportFailed', 'The export could not be produced. Try again.'));
      return;
    }
    downloadReport(uuid).then(
      () => finishExport(current),
      (e) => finishExport(current, errorText(e)),
    );
    // finishExport is left out: it reads only refs and state setters.
  },[exporting, exportRequest, exportPollError, t]);

  if (contextLoading || reportsLoading) {
    return <InlineLoading className={styles.container} description={t('loading', 'Loading reports...')} />;
  }

  const running = !!run && !isFinished(status);

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('indicatorReports', 'Indicator reports')}</h3>
      <p className={styles.explainer}>
        {t('explainer', 'MOH indicator reports, counted from this server’s report data. Aggregates only, no patient details.')}
      </p>

      <Freshness context={context} unavailable={!!contextError} />

      {reportsError ? (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t('reportsLoadError', 'Reports could not be loaded')}
          subtitle={errorText(reportsError)}
        />
      ) : reports.length === 0 ? (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={t('noReports', 'No MOH reports are available on this server')}
          subtitle={t('noReportsBody', 'The reports module may not be installed yet, or the report list is not configured.')}
        />
      ) : (
        <div className={styles.form}>
          <Select
            id="liberia-report"
            labelText={t('report', 'Report')}
            value={report?.uuid ?? ''}
            onChange={(event) => {
              setReportUuid(event.target.value);
              abandonRun();
            }}
          >
            {reports.map((r) => (
              <SelectItem key={r.uuid} value={r.uuid} text={r.display || r.name} />
            ))}
          </Select>
          {report?.description && (
            <InlineNotification
              kind="info"
              lowContrast
              hideCloseButton
              title={t('notCaptured', 'What this report cannot count')}
              subtitle={report.description}
            />
          )}

          <RadioButtonGroup
            legendText={t('periodType', 'Period')}
            name="liberia-report-period-type"
            valueSelected={periodType}
            onChange={(value) => {
              setPeriodType(value as PeriodType);
              setPeriodId('');
            }}
          >
            <RadioButton id="period-month" value="month" labelText={t('monthly', 'Month')} />
            <RadioButton id="period-quarter" value="quarter" labelText={t('quarterly', 'Quarter')} />
          </RadioButtonGroup>
          <Select
            id="liberia-report-period"
            labelText={periodType === 'month' ? t('month', 'Month') : t('quarter', 'Quarter')}
            value={period?.id ?? ''}
            onChange={(event) => setPeriodId(event.target.value)}
          >
            {periods.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                text={p.inProgress ? t('periodInProgress', '{{label}} (in progress)', { label: p.label }) : p.label}
              />
            ))}
          </Select>

          <LocationPicker
            context={context}
            facilityLocationTag={config.facilityLocationTag}
            mflCodeAttributeTypeUuid={config.mflCodeAttributeTypeUuid}
            maxFacilitiesShown={config.maxFacilitiesShown}
            onChange={onLocationChange}
          />

          <ButtonSet className={styles.actions}>
            <Button kind="primary" onClick={runReport} disabled={submitting || running || !csvDesign || !location}>
              {t('runReport', 'Run report')}
            </Button>
            {running && (
              <Button kind="secondary" onClick={cancelRun}>
                {t('cancel', 'Cancel')}
              </Button>
            )}
          </ButtonSet>
          {report && !designsLoading && !csvDesign && (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title={t('noCsvDesign', 'This report cannot be run yet')}
              subtitle={
                designs.length
                  ? t('noCsvDesignBody', 'It has no CSV format, which every run is rendered in. Ask ICT to add one.')
                  : t('noDesigns', 'This report has no export formats set up yet.')
              }
            />
          )}
        </div>
      )}

      {runError && (
        <InlineNotification kind="error" lowContrast title={t('runFailed', 'The report could not be run')} subtitle={runError} />
      )}

      {run && (
        <section className={styles.run} aria-live="polite">
          <div className={styles.runHeader}>
            <span>
              {t('runFor', '{{period}} · {{location}}', { period: run.periodLabel, location: run.locationName })}
            </span>
            <Tag type={succeeded ? 'green' : status === 'FAILED' ? 'red' : 'blue'} data-testid="run-status">
              {statusText(status, t)}
            </Tag>
          </div>

          {running && <InlineLoading description={t('running', 'Running the report...')} />}
          {status === 'FAILED' && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={t('runFailedOnServer', 'The report failed on the server')}
              subtitle={t('runFailedOnServerBody', 'Check the period and location, then run it again. If it fails again, ask ICT.')}
            />
          )}
          {pollError && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={t('statusUnknown', 'The report status could not be read')}
              subtitle={errorText(pollError)}
            />
          )}

          {succeeded && (
            <>
              <ButtonSet className={styles.actions}>
                <Button kind="tertiary" size="md" onClick={() => exportAs('csv')} disabled={!!exporting || !csvDesign}>
                  {t('downloadCsv', 'Download CSV')}
                </Button>
                <Button kind="tertiary" size="md" onClick={() => exportAs('xlsx')} disabled={!!exporting || !xlsxDesign}>
                  {t('downloadExcel', 'Download Excel')}
                </Button>
              </ButtonSet>
              {exporting && <InlineLoading description={t('exporting', 'Preparing the file...')} />}
              {exportError && (
                <InlineNotification kind="error" lowContrast title={t('exportFailed', 'The export could not be produced. Try again.')} subtitle={exportError} />
              )}

              {previewLoading && <InlineLoading description={t('loadingResults', 'Loading the figures...')} />}
              {previewError && (
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title={t('resultsLoadError', 'The figures could not be shown')}
                  subtitle={t('resultsLoadErrorBody', 'The downloads still work.')}
                />
              )}
              {dataSet && <ReportResults dataSet={dataSet} />}
            </>
          )}
        </section>
      )}
    </div>
  );
};

function statusText(status: string | undefined, t: (key: string, fallback: string) => string) {
  switch (status) {
    case 'COMPLETED':
    case 'SAVED':
      return t('statusCompleted', 'Completed');
    case 'FAILED':
      return t('statusFailed', 'Failed');
    case 'PROCESSING':
      return t('statusProcessing', 'Processing');
    default:
      return t('statusRequested', 'Queued');
  }
}

/** Stops a request no one will read. Best effort: at worst the server finishes a report nobody downloads. */
function discardRequest(requestUuid: string) {
  removeReportRequest(requestUuid).catch(() => undefined);
}

/** openmrsFetch throws an Error carrying the REST error body; show its message. */
function errorText(error: unknown): string {
  const e = error as { responseBody?: { error?: { message?: string } }; message?: string };
  return e?.responseBody?.error?.message ?? e?.message ?? String(error);
}

export default ReportRunner;
