import React from 'react';
import { useTranslation } from 'react-i18next';
import { InlineNotification } from '@carbon/react';
import { formatDatetime, parseDate } from '@openmrs/esm-framework';
import { etlRefreshState, type ReportingContext } from './reporting-context.resource';
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

  const state = etlRefreshState(context);
  const time = (value: string) => formatDatetime(parseDate(value));

  // Only a SUCCESS run's time is stated as how fresh the figures are. For ERROR and INTERRUPTED
  // the backend's times are the last good run's, rewritten by core, so none is shown.
  let lastRun: string;
  switch (state) {
    case 'current':
      lastRun = t('etlLastRun', 'Figures include data up to the last refresh, {{time}}.', {
        time: time(context.etlCompletedAt),
      });
      break;
    case 'refreshing':
      lastRun = context.etlCompletedAt
        ? t(
            'etlRunningSince',
            'A data refresh is in progress. Until it finishes, figures include data up to the last refresh, {{time}}.',
            { time: time(context.etlCompletedAt) },
          )
        : context.etlStartedAt
          ? t(
              'etlRunningStarted',
              'A data refresh is in progress; it started {{time}}. Until it finishes, figures are those of the previous refresh.',
              { time: time(context.etlStartedAt) },
            )
          : t('etlRunning', 'A data refresh is in progress. Until it finishes, figures are those of the previous refresh.');
      break;
    case 'failed':
      lastRun = t('etlFailed', 'The last data refresh failed; figures may be out of date. Contact ICT.');
      break;
    case 'unknown':
      lastRun = t(
        'etlStatusUnknown',
        'The state of the last data refresh is not known; figures may be out of date. Contact ICT.',
      );
      break;
    default:
      lastRun = unavailable
        ? t('etlUnknown', 'When the report data was last refreshed is not known on this server.')
        : t('etlNeverRun', 'The report data has not been refreshed yet on this server, so reports will be empty.');
  }

  return (
    <div className={styles.notices}>
      <InlineNotification
        kind={state === 'current' || state === 'refreshing' ? 'info' : 'warning'}
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
