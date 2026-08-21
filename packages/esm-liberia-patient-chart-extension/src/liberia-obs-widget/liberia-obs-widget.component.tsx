import React, { useCallback, useMemo, useState, useEffect } from 'react';
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
} from '@carbon/react';
import { Add, Analytics, Table as TableIcon } from '@carbon/react/icons';
import {
  formatDatetime,
  launchWorkspace2,
  openmrsFetch,
  restBaseUrl,
  useConfig,
  useVisit,
  showModal,
} from '@openmrs/esm-framework';
import { LineChart, type LineChartOptions, ScaleTypes } from '@carbon/charts-react';
import { CardHeader, EmptyState, ErrorState, PatientChartPagination } from '@openmrs/esm-patient-common-lib';
import { getObsDisplayValue, useObsByEncounter, type EncounterRep } from './use-obs-by-encounter';
import type { ConfigObject } from '../config-schema';
import styles from './liberia-obs-widget.scss';

interface LiberiaObsWidgetProps {
  patientUuid: string;
}

/**
 * Generic "Observations by Encounter" widget.
 *
 * - Rows = encounters (newest-first, by default, paged to config.maxEncounters)
 * - Columns = concepts from config.data (ordered as configured)
 * - "Add" = opens the AMPATH form identified by config.formUuid in the
 *             standard patient-form-entry-workspace (no custom workspace needed)
 *
 * Display mode is explicitly configured (table / graph / switchable) — it is
 * never auto-detected from observation data types.
 */
const LiberiaObsWidget: React.FC<LiberiaObsWidgetProps> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const config = useConfig<ConfigObject>();

  const [isPolling, setIsPolling] = useState(false);

  const { encounters, isLoading, error } = useObsByEncounter(patientUuid, isPolling);
  const { activeVisit } = useVisit(patientUuid);

  // Graph/table toggle state — only relevant when displayMode === 'switchable'
  const [showGraph, setShowGraph] = useState(false);

  // Fallback for when handlePostResponse is not supported by the environment's esm-form-engine-app version:
  // We simply listen for any click on a "Save" or "Submit" button and trigger a brief 2-second cache-busting poll.
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      if (button) {
        const text = button.innerText?.toLowerCase() || '';
        if (text.includes('save') || text.includes('submit')) {
          console.log('[liberia-obs-widget] Save/Submit clicked, triggering poll window');
          setIsPolling(true);
          setTimeout(() => setIsPolling(false), 2000);
        }
      }
    };
    
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  // Paginate encounters
  const [page, setPage] = useState(0);
  const pagedEncounters = useMemo(() => {
    const start = page * config.maxEncounters;
    return encounters.slice(start, start + config.maxEncounters);
  }, [encounters, page, config.maxEncounters]);

  /** Launch the configured AMPATH form in the standard O3 workspace drawer */
  const handleLaunchForm = useCallback(
    async (encounterUuid?: string) => {
      if (!config.formUuid) {
        return;
      }
      
      const doLaunch = async () => {
        const { data } = await openmrsFetch(`${restBaseUrl}/form/${config.formUuid}?v=custom:(uuid,name,display)`);

        launchWorkspace2('patient-form-entry-workspace', {
          workspaceTitle: data?.display ?? data?.name ?? config.title,
          form: data,
          encounterUuid,
          additionalProps: {
            mode: encounterUuid ? 'edit' : 'enter',
            formSessionIntent: '*',
            openClinicalFormsWorkspaceOnFormClose: false,
          },
        });
      };

      if (!activeVisit) {
        const dispose = showModal('start-visit-dialog', {
          closeModal: () => dispose(),
          onVisitStarted: doLaunch,
        });
      } else {
        doLaunch();
      }
    },
    [config.formUuid, config.title, activeVisit],
  );

  if (isLoading) {
    return <DataTableSkeleton columnCount={config.maxEncounters + 1} rowCount={config.data.length} />;
  }

  if (error) {
    return <ErrorState error={error} headerTitle={config.title} />;
  }

  if (!encounters.length) {
    return (
      <EmptyState
        displayText={config.title.toLowerCase()}
        headerTitle={config.title}
        launchForm={config.formUuid && config.showAddButton !== false ? () => handleLaunchForm() : undefined}
      />
    );
  }

  const showSwitcher = config.displayMode === 'switchable';

  return (
    <div className={styles.widgetContainer}>
      <CardHeader title={t(config.title)}>
        <div className={styles.headerActions}>
          {/* Refresh indicator */}
          <span className={styles.loadingIndicator}>{isLoading ? <InlineLoading /> : null}</span>

          {/* Table/Graph toggle — only rendered when displayMode === 'switchable' */}
          {showSwitcher && (
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
          )}

          {/* Add button — always visible when formUuid is configured */}
          {config.formUuid && config.showAddButton !== false && (
            <Button
              kind="ghost"
              renderIcon={Add}
              iconDescription={t('addEncounter', 'Add')}
              size="sm"
              onClick={() => handleLaunchForm()}
            >
              {t('add', 'Add')}
            </Button>
          )}
        </div>
      </CardHeader>

      {/* Table view (default, or when displayMode === 'table' or 'switchable' and showGraph is false) */}
      {(config.displayMode === 'table' || (showSwitcher && !showGraph)) && (
        <>
          <ObsTable
            encounters={pagedEncounters}
            configData={config.data}
          />
          {/* Pagination controls */}
          <PatientChartPagination
            currentItems={pagedEncounters.length}
            totalItems={encounters.length}
            pageNumber={page + 1}
            pageSize={config.maxEncounters}
            onPageNumberChange={(data: any) => setPage(data.page - 1)}
            dashboardLinkUrl={`${window.spaBase}/patient/${patientUuid}/chart/patient-summary`}
          />
        </>
      )}

      {/* Graph view - rendered when displayMode === 'graph' or switchable+showGraph */}
      {(config.displayMode === 'graph' || (showSwitcher && showGraph)) && (
        <ObsGraph encounters={encounters} configData={config.data} title={config.title} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: vertical table (rows = encounters, columns = concepts)
// ---------------------------------------------------------------------------

interface ObsTableProps {
  encounters: EncounterRep[];
  configData: ConfigObject['data'];
}

const ObsTable: React.FC<ObsTableProps> = ({ encounters, configData }: ObsTableProps) => {
  const { t } = useTranslation();

  return (
    <TableContainer>
      <Table size="sm" useZebraStyles experimentalAutoAlign>
        <TableHead>
          <TableRow>
            <TableHeader>{t('dateAndTime', 'Date and time')}</TableHeader>
            {configData.map(({ concept, label }: any) => (
              <TableHeader key={concept}>{label || concept}</TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {encounters.map((enc: any) => (
            <TableRow key={enc.uuid}>
              <TableCell>
                {formatDatetime(new Date(enc.encounterDatetime), { mode: 'wide' })}
              </TableCell>
              {configData.map(({ concept }: any) => {
                const obs = enc.obs.find((o: any) => o.concept.uuid === concept);
                return (
                  <TableCell key={`${concept}-${enc.uuid}`}>{getObsDisplayValue(obs)}</TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: Line Graph using @carbon/charts-react
// ---------------------------------------------------------------------------

interface ObsGraphProps extends ObsTableProps {
  title: string;
}

const ObsGraph: React.FC<ObsGraphProps> = ({ encounters, configData, title }: ObsGraphProps) => {
  const { t } = useTranslation();
  const [selectedConceptIndex, setSelectedConceptIndex] = useState(0);

  const getChartDataForConcept = useCallback((conceptUuid: string, label: string) => {
    return encounters.map((enc) => {
      const obs = enc.obs.find((o: any) => o.concept.uuid === conceptUuid);
      if (!obs) return null;
      
      let value = 0;
      if (typeof obs.value === 'object' && obs.value !== null && 'display' in obs.value) {
         value = parseFloat(obs.value.display);
      } else if (typeof obs.value === 'number') {
         value = obs.value;
      } else if (typeof obs.value === 'string') {
         value = parseFloat(obs.value);
      } else {
         value = parseFloat(getObsDisplayValue(obs));
      }

      if (isNaN(value)) return null;
      
      return {
        group: label || conceptUuid,
        key: new Date(enc.encounterDatetime),
        value: value,
        date: enc.encounterDatetime,
      };
    }).filter(Boolean);
  }, [encounters]);

  const safeIndex = configData.length > 0 ? Math.min(selectedConceptIndex, configData.length - 1) : 0;
  const selectedConcept = configData[safeIndex];
  
  const chartData = useMemo(() => {
    if (!selectedConcept) return [];
    return getChartDataForConcept(selectedConcept.concept, selectedConcept.label);
  }, [getChartDataForConcept, selectedConcept]);

  const chartOptions: LineChartOptions = useMemo(() => {
    if (!selectedConcept) return {} as LineChartOptions;
    return {
      title: t(selectedConcept.label || selectedConcept.concept),
      axes: {
        bottom: {
          title: t('date', 'Date'),
          mapsTo: 'key',
          scaleType: ScaleTypes.TIME,
        },
        left: {
          mapsTo: 'value',
          title: t(selectedConcept.label || selectedConcept.concept),
          scaleType: ScaleTypes.LINEAR,
          includeZero: false,
        },
      },
      legend: {
        enabled: false,
      },
      tooltip: {
        customHTML: ([{ value, group, date }]: any) => {
          const dateLabel = t('date', 'Date');
          return `<div class="cds--tooltip cds--tooltip--shown" style="min-width: max-content; font-weight:600">
              <div style="font-size:1rem; line-height:1.4">${group}: <span>${value}</span></div>
              <div style="color:#6F6F6F; font-size:0.875rem; font-weight:500; margin-top:0.125rem">${dateLabel}: ${formatDatetime(new Date(date), { mode: 'wide' })}</div>
            </div>`;
        },
      },
      toolbar: {
        enabled: true,
        numberOfIcons: 4,
        controls: [
          { type: 'Zoom in' },
          { type: 'Zoom out' },
          { type: 'Reset zoom' },
          { type: 'Export as CSV' },
          { type: 'Export as PNG' },
          { type: 'Make fullscreen' },
        ],
      },
      zoomBar: {
        top: {
          enabled: true,
        },
      },
      height: '400px',
    };
  }, [t, selectedConcept]);

  if (!selectedConcept || !encounters.some((enc) => enc.obs.length > 0)) {
    return (
      <div className={styles.graphPlaceholder}>
        <p>{t('noNumericData', 'No numeric data available to graph.')}</p>
      </div>
    );
  }

  return (
    <div className={styles.graphWidgetContainer}>
      <div className={styles.conceptPickerTabs}>
        <label className={styles.vitalsSignLabel}>
          {t('titleDisplayed', `${title} displayed`)}
        </label>
        <div className={styles.tabsAndChartArea}>
          <TabsVertical>
            <TabListVertical aria-label="Graph tabs">
              {configData.map((conceptObj: any, index: number) => (
                <Tab
                  key={conceptObj.concept}
                  className={styles.tab}
                  onClick={() => setSelectedConceptIndex(index)}
                >
                  {conceptObj.label || conceptObj.concept}
                </Tab>
              ))}
            </TabListVertical>
            <TabPanels>
               {configData.map((conceptObj: any) => (
                 <TabPanel key={conceptObj.concept}>
                   <div className={styles.lineChartContainer}>
                     {chartData.length > 0 ? (
                       <LineChart data={chartData} options={chartOptions} />
                     ) : (
                       <div className={styles.graphPlaceholder} style={{ marginTop: '4rem' }}>
                         <p>{t('noNumericData', 'No data points available for this concept.')}</p>
                       </div>
                     )}
                   </div>
                 </TabPanel>
               ))}
            </TabPanels>
          </TabsVertical>
        </div>
      </div>
    </div>
  );
};

export default LiberiaObsWidget;
