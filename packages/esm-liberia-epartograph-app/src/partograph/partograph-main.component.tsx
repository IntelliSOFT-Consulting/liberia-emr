import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ContentSwitcher,
  DataTableSkeleton,
  IconSwitch,
  InlineLoading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tab,
  TabListVertical,
  TabPanel,
  TabPanels,
  TabsVertical,
  Tooltip,
} from '@carbon/react';
import { Add, Analytics, Table as TableIcon } from '@carbon/react/icons';
import {
  formatDatetime,
  getGlobalStore,
  launchWorkspace2,
  openmrsFetch,
  restBaseUrl,
  showSnackbar,
  useConfig,
  usePatient,
} from '@openmrs/esm-framework';
import {
  CardHeader,
  ErrorState,
  PatientChartPagination,
  useStartVisitIfNeeded,
  type PatientChartStore,
} from '@openmrs/esm-patient-common-lib';
import { PartographEmptyState } from './partograph-empty-state.component';
import { usePartographEncounters, findObs, getObsDisplayValue } from './use-partograph-encounters';
import { usePartographAlerts } from './cds/use-partograph-alerts';
import PartographAlertsDisplay from './cds/partograph-alerts-display.component';
import CompositePartographChart from './charts/composite-partograph-chart.component';
import type { EPartographConfig } from '../config-schema';
import styles from './partograph-main.scss';

interface PartographMainProps {
  patientUuid: string;
}

/**
 * Ordered list of clinical parameter tabs matching the design mockup.
 * Each entry maps a tab label to the concept UUID key in config.concepts.
 * The first two (Cervical Dilatation + Fetal Head Descent) share a composite chart.
 */
const PARTOGRAPH_TABS = [
  { labelKey: 'fetalHeartRate', label: 'Fetal Heart Rate', conceptKey: 'fetalHeartRateUuid', unit: 'beats/min' },
  { labelKey: 'compositeChart', label: 'Cervical dilatation and Fetal Head Descent', conceptKey: null, unit: '' },
  { labelKey: 'contractions', label: 'Contractions per 10 minutes', conceptKey: 'contractionsPerTenMinutesUuid', unit: '' },
  { labelKey: 'pulseRate', label: 'Pulse Rate', conceptKey: 'pulseUuid', unit: 'bpm' },
  { labelKey: 'bloodPressure', label: 'Blood Pressure', conceptKey: 'systolicBloodPressureUuid', unit: 'mmHg' },
  { labelKey: 'temperature', label: 'Temperature', conceptKey: 'temperatureUuid', unit: '°C' },
  { labelKey: 'proteinsInUrine', label: 'Proteins in urine', conceptKey: 'proteinsInUrineUuid', unit: '' },
  { labelKey: 'acetoneInUrine', label: 'Acetone in urine', conceptKey: 'acetoneInUrineUuid', unit: '' },
  { labelKey: 'urineVolume', label: 'Urine Volume', conceptKey: 'urineVolumeUuid', unit: 'mL' },
];

/** Number of encounters per page in table mode. */
const PAGE_SIZE = 10;

/**
 * PartographMain
 *
 * Primary container for the WHO Electronic Partograph dashboard.
 * Provides:
 *  - ContentSwitcher between Table view and Graph view (matching the UI designs)
 *  - CDS alert toasts (Normal / Alert / Action / Due)
 *  - Graph mode: vertical tab selector for clinical parameters + WHO composite chart
 *  - Table mode: paginated serial observation table
 *  - "Add +" button launching the partograph AMPATH form in the O3 workspace drawer
 */
const PartographMain: React.FC<PartographMainProps> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const config = useConfig<EPartographConfig>();
  const { patient, isLoading: isLoadingPatient } = usePatient(patientUuid);

  const {
    encounters,
    isDelivered,
    hasAdmissionEncounter,
    hasActiveLabourDilation,
    isLoading,
    error,
    mutate,
  } = usePartographEncounters(patientUuid);
  const startVisitIfNeeded = useStartVisitIfNeeded(patientUuid);

  const isFemale = useMemo(() => {
    if (!patient) return true;
    const gender = patient.gender?.toLowerCase();
    return gender === 'female' || gender === 'f';
  }, [patient]);

  // Graph/table view toggle
  const [showGraph, setShowGraph] = useState(false); // default to table view

  // Selected tab index in graph mode
  const [selectedTabIndex, setSelectedTabIndex] = useState(0); // default to first tab (Fetal Heart Rate)

  // Pagination for table mode (encounters are oldest-first; we show newest-first in table)
  const [page, setPage] = useState(0);
  const encountersNewestFirst = useMemo(() => [...encounters].reverse(), [encounters]);
  const pagedEncounters = useMemo(() => {
    const start = page * PAGE_SIZE;
    return encountersNewestFirst.slice(start, start + PAGE_SIZE);
  }, [encountersNewestFirst, page]);

  // CDS alert status (suppresses intrapartum alerts if delivery has already occurred)
  const alerts = usePartographAlerts(encounters, config, isDelivered);

  /** Launch the partograph AMPATH form in the O3 workspace drawer. */
  const handleLaunchForm = useCallback(
    async (encounterUuid?: string) => {
      if (!config.formUuid) {
        showSnackbar({ kind: 'error', title: t('formNotConfigured', 'Partograph form UUID not configured.') });
        return;
      }
      const didStartVisit = await startVisitIfNeeded();
      if (!didStartVisit) return;

      let formData: { uuid: string; name?: string; display?: string } | undefined;
      try {
        const response = await openmrsFetch(`${restBaseUrl}/form/${config.formUuid}?v=custom:(uuid,name,display)`);
        formData = response.data;
      } catch (err: any) {
        showSnackbar({ kind: 'error', title: t('formLoadFailed', 'Unable to load form'), subtitle: err?.message });
        return;
      }

      const chartStore = getGlobalStore<PatientChartStore>('patient-chart-global-store')?.getState();

      launchWorkspace2(
        'patient-form-entry-workspace',
        {
          workspaceTitle: formData?.display ?? formData?.name ?? t('partograph', 'Partograph'),
          form: formData,
          encounterUuid: encounterUuid ?? '',
          additionalProps: {
            mode: encounterUuid ? 'edit' : 'enter',
            formSessionIntent: '*',
            openClinicalFormsWorkspaceOnFormClose: false,
          },
        },
        {},
        {
          patient: chartStore?.patient,
          patientUuid,
          visitContext: chartStore?.visitContext,
          mutateVisitContext: () => {
            chartStore?.mutateVisitContext?.();
            mutate();
          },
        },
      );
    },
    [config.formUuid, startVisitIfNeeded, patientUuid, mutate, t],
  );

  // ── Loading / Error / Empty states ──────────────────────────────────────────

  if (isLoading || isLoadingPatient) {
    return <DataTableSkeleton columnCount={5} rowCount={5} />;
  }

  if (patient && !isFemale) {
    return (
      <div className={styles.widgetContainer}>
        <CardHeader title={t('partograph', 'Partograph')}>
          <span />
        </CardHeader>
        <div className={styles.femaleOnlyNotice}>
          <p>{t('partographFemaleOnly', 'The Partograph is only available for female patients.')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} headerTitle={t('partograph', 'Partograph')} />;
  }

  // Prerequisite 1: Admission check ("1. First and Second Stage of Labor and Delivery")
  if (!hasAdmissionEncounter && !hasActiveLabourDilation) {
    return (
      <PartographEmptyState
        headerTitle={t('partograph', 'Partograph')}
        message={t(
          'partographAdmissionRequired',
          'The Partograph is only available after a "1. First and Second Stage of Labor and Delivery" encounter has been completed.',
        )}
      />
    );
  }

  // Prerequisite 2: Cervical dilatation threshold (≥ 4 cm / active labour)
  if (!hasActiveLabourDilation) {
    return (
      <PartographEmptyState
        headerTitle={t('partograph', 'Partograph')}
        message={t(
          'noPartographsUntil4cm',
          'There are no Partograph to display for this patient until cervical dilatation is 4cm',
        )}
        launchForm={config.formUuid ? () => handleLaunchForm() : undefined}
      />
    );
  }

  if (!encounters.length) {
    return (
      <PartographEmptyState
        headerTitle={t('partograph', 'Partograph')}
        message={t(
          'noPartographToDisplay',
          'There are no Partograph to display for this patient',
        )}
        launchForm={config.formUuid ? () => handleLaunchForm() : undefined}
      />
    );
  }

  // ── Rendered widget ──────────────────────────────────────────────────────────

  const selectedTab = PARTOGRAPH_TABS[selectedTabIndex];

  return (
    <div className={styles.widgetContainer}>
      {/* ── Header: Title + ContentSwitcher + Add button ── */}
      <CardHeader title={t('partograph', 'Partograph')}>
        <div className={styles.headerActions}>
          <span className={styles.loadingIndicator}>{isLoading ? <InlineLoading /> : null}</span>

          {/* Table / Graph toggle */}
          <ContentSwitcher
            size="sm"
            selectedIndex={showGraph ? 1 : 0}
            onChange={(evt: any) => setShowGraph(evt.name === 'graph')}
          >
            <IconSwitch name="table" text={t('tableView', 'Table view')}>
              <TableIcon size={16} />
            </IconSwitch>
            <IconSwitch name="graph" text={t('graphView', 'Graph view')}>
              <Analytics size={16} />
            </IconSwitch>
          </ContentSwitcher>

          {/* Add button */}
          <Button kind="ghost" renderIcon={Add} iconDescription={t('add', 'Add')} size="sm" onClick={() => handleLaunchForm()}>
            {t('add', 'Add')}
          </Button>
        </div>
      </CardHeader>

      {/* ── CDS Alerts ── */}
      <PartographAlertsDisplay alerts={alerts} config={config} onLaunchForm={handleLaunchForm} />

      {/* ── Graph mode ── */}
      {showGraph && (
        <div className={styles.graphWidgetContainer}>
          <div className={styles.conceptPickerTabs}>
            <label className={styles.vitalsSignLabel}>
              {t('partographDisplayed', 'Partograph displayed')}
            </label>
            <div className={styles.tabsAndChartArea}>
              <TabsVertical
                selectedIndex={selectedTabIndex}
                onChange={({ selectedIndex }) => setSelectedTabIndex(selectedIndex)}
              >
                <TabListVertical aria-label={t('partographParameters', 'Partograph parameters')}>
                  {PARTOGRAPH_TABS.map((tab) => (
                    <Tab key={tab.labelKey} className={styles.tab}>
                      {t(tab.labelKey, tab.label)}
                    </Tab>
                  ))}
                </TabListVertical>
                <TabPanels>
                  {PARTOGRAPH_TABS.map((tab, idx) => (
                    <TabPanel key={tab.labelKey}>
                      {idx === selectedTabIndex && (
                        <>
                          {tab.conceptKey === null ? (
                            // Composite WHO Partograph Chart (Dilation + Descent + Alert/Action lines)
                            <CompositePartographChart
                              encounters={encounters}
                              config={config}
                              title={t('cervicalDilationAndFetalHeadDescent', 'Cervical dilatation and Fetal Head Descent')}
                            />
                          ) : (
                            // Single-series standard vitals chart
                            <CompositePartographChart
                              encounters={encounters}
                              config={config}
                              seriesConceptUuid={(config.concepts as any)[tab.conceptKey]}
                              seriesLabel={`${t(tab.labelKey, tab.label)}${tab.unit ? ` (${tab.unit})` : ''}`}
                              title={`${t(tab.labelKey, tab.label)}${tab.unit ? ` (${tab.unit})` : ''}`}
                            />
                          )}
                        </>
                      )}
                    </TabPanel>
                  ))}
                </TabPanels>
              </TabsVertical>
            </div>
          </div>
        </div>
      )}

      {/* ── Table mode ── */}
      {!showGraph && (
        <>
          <PartographObsTable encounters={pagedEncounters} config={config} />
          <PatientChartPagination
            currentItems={pagedEncounters.length}
            totalItems={encountersNewestFirst.length}
            pageNumber={page + 1}
            pageSize={PAGE_SIZE}
            onPageNumberChange={(data: any) => setPage(data.page - 1)}
            dashboardLinkUrl={`${window.spaBase}/patient/${patientUuid}/chart/patient-summary`}
          />
        </>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Sub-component: Serial observation table
// ──────────────────────────────────────────────────────────────────────────────

interface TruncatedTextCellProps {
  text: string;
  maxLength?: number;
}

const TruncatedTextCell: React.FC<TruncatedTextCellProps> = ({ text, maxLength = 25 }) => {
  if (!text || text === '--') return <span>--</span>;
  if (text.length <= maxLength) return <span>{text}</span>;

  return (
    <Tooltip align="bottom" label={text}>
      <span className={styles.truncatedText} title={text}>
        {text.slice(0, maxLength)}…
      </span>
    </Tooltip>
  );
};

interface PartographObsTableProps {
  encounters: ReturnType<typeof usePartographEncounters>['encounters'];
  config: EPartographConfig;
}

/**
 * Renders a Carbon DataTable with rows = encounters (newest-first) and
 * columns = the key partograph concepts.
 */
const PartographObsTable: React.FC<PartographObsTableProps> = ({ encounters, config }) => {
  const { t } = useTranslation();
  const {
    fetalHeartRateUuid,
    amnioticFluidUuid,
    mouldingUuid,
    cervicalDilationUuid,
    contractionsPerTenMinutesUuid,
    oxytocinUnitsPerLitreUuid,
    drugsAndIvFluidsUuid,
  } = config.concepts;

  return (
    <div className={styles.tableContainer}>
      <TableContainer>
        <Table size="sm" useZebraStyles experimentalAutoAlign>
          <TableHead>
            <TableRow>
              <TableHeader>{t('dateAndTime', 'Date and Time')}</TableHeader>
              <TableHeader>{t('fetalHeartRate', 'Fetal Heart Rate (bpm)')}</TableHeader>
              <TableHeader>{t('amnioticFluid', 'Amniotic fluid')}</TableHeader>
              <TableHeader>{t('moulding', 'Moulding')}</TableHeader>
              <TableHeader>{t('cervicalDilationCm', 'Cervical dilatation (cm)')}</TableHeader>
              <TableHeader>{t('contractions', 'Contractions')}</TableHeader>
              <TableHeader>{t('oxytocinUnitsTable', 'Oxytocin (U/L/min)')}</TableHeader>
              <TableHeader>{t('drugsIvFluids', 'Drugs given and IV Fluids')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {encounters.map((enc) => (
              <TableRow key={enc.uuid}>
                <TableCell>{formatDatetime(new Date(enc.encounterDatetime), { mode: 'wide' })}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, fetalHeartRateUuid))}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, amnioticFluidUuid))}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, mouldingUuid))}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, cervicalDilationUuid))}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, contractionsPerTenMinutesUuid))}</TableCell>
                <TableCell>{getObsDisplayValue(findObs(enc, oxytocinUnitsPerLitreUuid))}</TableCell>
                <TableCell>
                  <TruncatedTextCell text={getObsDisplayValue(findObs(enc, drugsAndIvFluidsUuid))} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
};

export default PartographMain;
