import React from 'react';
import { useTranslation } from 'react-i18next';
import { InlineNotification } from '@carbon/react';
import { formatDatetime, parseDate } from '@openmrs/esm-framework';
import { type ReportingContext } from './reporting-context.resource';
import styles from '../reports/reports.scss';

interface FreshnessProps {
  context: ReportingContext;
  /** The context endpoint did not answer. */
  unavailable: boolean;
}

/**
 * Reports read the ETL schema, not live data, so every figure is as old as the last ETL run.
 * At central there is a second delay before that: sync (ADR 0010 decision 5, "Lag").
 */
const Freshness: React.FC<FreshnessProps> = ({ context, unavailable }) => {
  const { t } = useTranslation();

  const lastRun = context.etlCompletedAt
    ? t('etlLastRun', 'Figures include data up to the last refresh, {{time}}.', {
        time: formatDatetime(parseDate(context.etlCompletedAt)),
      })
    : unavailable
      ? t('etlUnknown', 'When the report data was last refreshed is not known on this server.')
      : t('etlNeverRun', 'The report data has not been refreshed yet on this server, so reports will be empty.');

  return (
    <div className={styles.notices}>
      <InlineNotification
        kind={context.etlCompletedAt ? 'info' : 'warning'}
        lowContrast
        hideCloseButton
        title={t('dataFreshness', 'Report data')}
        subtitle={lastRun}
      />
      {context.role === 'central' && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('centralLag', 'Central figures lag the facilities')}
          subtitle={t(
            'centralLagBody',
            "A facility's own report can be ahead of this one until its records have synced to central and the next refresh has run. For the latest figures for one facility, run the report at that facility.",
          )}
        />
      )}
      {context.available && context.roleUnknown && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={t('roleUnknown', "This server's role is not known")}
          subtitle={t(
            'roleUnknownBody',
            'Reports run for this facility only. If this is the national server, ask ICT to check the reports module.',
          )}
        />
      )}
    </div>
  );
};

export default Freshness;
