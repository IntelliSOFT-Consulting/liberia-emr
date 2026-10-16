import React, { useMemo, useState } from 'react';
import { DataTableSkeleton, Dropdown, Tag } from '@carbon/react';
import { useConfig, useLayoutType } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { facilityKey, filterByFacility } from './external-records';
import type { ExternalRecordsConfig } from './external-records-config';
import { ancContactSectionId, sectionDefinitions } from './external-records-sections';
import { useExternalRecords } from './use-external-records';
import ExternalAncContactCard from './components/external-anc-contact.component';
import ExternalRecordsStatusView from './components/external-records-status.component';
import ExternalRecordsTable from './components/external-records-table.component';
import styles from './external-records.scss';

interface ExternalRecordsDashboardProps {
  patientUuid: string;
}

interface FacilityOption {
  key: string | null;
  label: string;
}

/** The External records dashboard (5a, 6a–6f): every section, filterable by facility, read-only. */
const ExternalRecordsDashboard: React.FC<ExternalRecordsDashboardProps> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const { externalRecords: config } = useConfig<{ externalRecords: ExternalRecordsConfig }>();
  const isTablet = useLayoutType() === 'tablet';
  const records = useExternalRecords(patientUuid);
  const [selected, setSelected] = useState<string | null>(null);

  const options = useMemo<Array<FacilityOption>>(
    () => [
      {
        key: null,
        label: t('allFacilities', 'All facilities ({{count}})', { count: records.facilities.length }),
      },
      ...records.facilities.map((facility) => ({
        key: facilityKey(facility),
        label: facility.name ?? String(t('unknownFacility', 'Unknown facility')),
      })),
    ],
    [records.facilities, t],
  );
  const current = options.find((option) => option.key === selected) ?? options[0];
  const sections = useMemo(() => filterByFacility(records.sections, selected), [records.sections, selected]);

  if (records.isLoading) {
    return <DataTableSkeleton rowCount={4} columnCount={4} />;
  }
  if (!records.isImported || !records.status) {
    return null;
  }

  const showData = ['fresh', 'offline', 'stale'].includes(records.status);
  const facilityLabel = selected === null ? undefined : current.label;

  return (
    <div className={styles.dashboard}>
      <div className={styles.dashboardTop}>
        <div className={styles.dashboardIntro}>
          <div className={styles.dashboardHeader}>
            <h2 className={styles.dashboardTitle}>{t('externalRecords', 'External records')}</h2>
            <Tag type="purple" size="sm">
              {t('externalReadOnly', 'External · Read-only')}
              <span className="cds--visually-hidden">
                : {t('externalTagHint', 'Recorded at another facility')}. {t('readOnlyTagHint', 'Cannot be changed here')}
              </span>
            </Tag>
          </div>
          <p className={styles.description}>
            {t(
              'externalRecordsDashboardDescription',
              "These records belong to the facility that recorded them. They are read-only here and are not added to this facility's chart.",
            )}
          </p>
        </div>
        {showData && records.facilities.length > 0 && (
          <div className={styles.filter}>
            <Dropdown<FacilityOption>
              id="external-records-facility"
              titleText={t('facility', 'Facility')}
              label=""
              items={options}
              itemToString={(option) => option?.label ?? ''}
              selectedItem={current}
              onChange={({ selectedItem }) => setSelected(selectedItem?.key ?? null)}
              size={isTablet ? 'lg' : 'md'}
            />
          </div>
        )}
      </div>
      <ExternalRecordsStatusView
        status={records.status}
        asOf={records.asOf}
        isRefreshing={records.isRefreshing}
        onRefresh={records.refresh}
        detailed
      />
      {showData && (
        <div className={isTablet ? styles.widgetsStacked : styles.widgets}>
          {config.dashboardSections.map((id) => {
            if (id === ancContactSectionId) {
              return (
                <ExternalAncContactCard key={id} contact={sections.lastAncContact} facilityLabel={facilityLabel} />
              );
            }
            const section = sectionDefinitions[id];
            if (!section) return null;
            return (
              <div key={id} className={id === 'encounters' ? styles.fullWidth : undefined}>
                <ExternalRecordsTable
                  section={section}
                  rows={section.rows(sections)}
                  pageSize={config.pageSize}
                  variant="dashboard"
                  facilityLabel={facilityLabel}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ExternalRecordsDashboard;
