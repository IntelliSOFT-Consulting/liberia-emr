import React from 'react';
import { Button, DataTableSkeleton } from '@carbon/react';
import { ArrowRight } from '@carbon/react/icons';
import { navigate, useConfig, useLayoutType, useSession } from '@openmrs/esm-framework';
import { CardHeader } from '@openmrs/esm-patient-common-lib';
import { useTranslation } from 'react-i18next';
import { dashboardUrl, type ExternalRecordsConfig } from './external-records-config';
import { sectionDefinitions } from './external-records-sections';
import { useExternalRecords } from './use-external-records';
import ExternalRecordsStatusView from './components/external-records-status.component';
import ExternalRecordsTable from './components/external-records-table.component';
import styles from './external-records.scss';

interface ExternalRecordsSummaryProps {
  patientUuid: string;
}

/** Patient Summary card (4a, 6a–6f): status plus the configured sections, at most two. */
const ExternalRecordsSummary: React.FC<ExternalRecordsSummaryProps> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const { externalRecords: config } = useConfig<{ externalRecords: ExternalRecordsConfig }>();
  const session = useSession();
  const isTablet = useLayoutType() === 'tablet';
  const records = useExternalRecords(patientUuid);

  if (records.isLoading) {
    return <DataTableSkeleton rowCount={2} columnCount={4} />;
  }
  if (!records.isImported || !records.status) {
    return null;
  }

  const showData = ['fresh', 'offline', 'stale'].includes(records.status);
  const sections = config.summarySections.map((id) => sectionDefinitions[id]).filter(Boolean);

  return (
    <div className={styles.card}>
      <CardHeader title={t('externalRecords', 'External records')}>
        <Button
          kind="ghost"
          size={isTablet ? 'md' : 'sm'}
          renderIcon={(props) => <ArrowRight size={16} {...props} />}
          iconDescription={t('viewAllExternalRecords', 'View All External Records')}
          onClick={() => navigate({ to: dashboardUrl(patientUuid) })}
        >
          {t('viewAllExternalRecords', 'View All External Records')}
        </Button>
      </CardHeader>
      <div className={styles.cardBody}>
        <p className={styles.description}>
          {t(
            'externalRecordsDescription',
            "A read-only copy of this patient's records at other facilities. These records are not part of {{facility}}'s records and cannot be changed here.",
            { facility: session?.sessionLocation?.display ?? t('thisFacility', 'this facility') },
          )}
        </p>
        <ExternalRecordsStatusView
          status={records.status}
          asOf={records.asOf}
          isRefreshing={records.isRefreshing}
          onRefresh={records.refresh}
        />
        {showData && (
          <div className={isTablet ? styles.widgetsStacked : styles.widgets}>
            {sections.map((section) => (
              <ExternalRecordsTable
                key={section.id}
                section={section}
                rows={section.rows(records.sections)}
                pageSize={config.pageSize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExternalRecordsSummary;
