import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  InlineLoading,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from '@carbon/react';
import { ConfigurableLink, formatDate } from '@openmrs/esm-framework';
import { useSyncStatus } from './sync-status.resource';
import styles from './sync-status.scss';

/**
 * Shows what central knows about each facility's sync, and what is waiting at central.
 *
 * Stuck records and conflicts are national totals rather than per facility: dbsync records no
 * sender on a queued record, so central cannot say which facility one came from.
 */
const SyncStatus: React.FC = () => {
  const { t } = useTranslation();
  const { status, error, isLoading } = useSyncStatus();

  if (isLoading) {
    return <InlineLoading className={styles.container} description={t('loading', 'Loading sync status...')} />;
  }

  // Told apart on purpose: "you may not read this" is a different problem from "there is
  // nothing here to read", and an operator sent to the wrong one wastes a call to ICT.
  if (error?.response?.status === 403) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('notPermitted', 'You do not have permission to see sync status')}
          subtitle={t('askForPrivilege', 'Ask ICT for the View Sync Status privilege.')}
        />
      </div>
    );
  }

  if (error || !status?.enabled) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('notAvailableHere', 'Sync status is not available on this server')}
          subtitle={t('centralOnly', 'The national sync view is shown at central, not at a facility.')}
        />
      </div>
    );
  }

  const central = status.central;
  const facilities = status.facilities ?? [];

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('syncStatus', 'Sync status')}</h3>
      <p className={styles.explainer}>
        {t('explainer', 'How facilities are sending records to the national server, and what is waiting here.')}
      </p>

      {status.available === false && (
        <InlineNotification
          className={styles.notice}
          kind="warning"
          lowContrast
          hideCloseButton
          title={t('monitoringUnreachable', 'Monitoring cannot be reached')}
          subtitle={t('monitoringUnreachableBody', 'Sync may still be healthy. The numbers below are unavailable until monitoring answers again.')}
        />
      )}

      {status.alerts?.length ? (
        <InlineNotification
          className={styles.notice}
          kind="error"
          lowContrast
          hideCloseButton
          title={t('alertsFiring', 'Alerts firing')}
          subtitle={status.alerts.join(', ')}
        />
      ) : null}

      {central && (
        <div className={styles.tiles}>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>{central.recordsWaiting}</div>
            <div className={styles.tileLabel}>{t('recordsWaiting', 'Records waiting to be applied')}</div>
          </Tile>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>{central.recordsRetrying}</div>
            <div className={styles.tileLabel}>{t('recordsRetrying', 'Records retrying')}</div>
          </Tile>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>{central.conflicts}</div>
            <div className={styles.tileLabel}>{t('conflicts', 'Conflicts to resolve')}</div>
            {central.conflicts > 0 && (
              <ConfigurableLink to="${openmrsSpaBase}/sync-conflicts">{t('reviewConflicts', 'Review')}</ConfigurableLink>
            )}
          </Tile>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>{central.deadLetters}</div>
            <div className={styles.tileLabel}>{t('deadLetters', 'Records set aside')}</div>
          </Tile>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>
              <Tag type={central.receiverUp ? 'green' : 'red'}>
                {central.receiverUp ? t('running', 'Running') : t('stopped', 'Stopped')}
              </Tag>
            </div>
            <div className={styles.tileLabel}>{t('receiver', 'Receiver')}</div>
          </Tile>
          <Tile className={styles.tile}>
            <div className={styles.tileValue}>
              <Tag type={central.brokerUp ? 'green' : 'red'}>
                {central.brokerUp ? t('running', 'Running') : t('stopped', 'Stopped')}
              </Tag>
            </div>
            <div className={styles.tileLabel}>{t('broker', 'Broker')}</div>
          </Tile>
        </div>
      )}

      <TableContainer title={t('facilities', 'Facilities')}>
        <Table size="sm" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader>{t('facility', 'Facility')}</TableHeader>
              <TableHeader>{t('sending', 'Sending')}</TableHeader>
              <TableHeader>{t('recordsLastDay', 'Records in the last day')}</TableHeader>
              <TableHeader>{t('recordsTotal', 'Records received in total')}</TableHeader>
              <TableHeader>{t('certificateExpires', 'Certificate expires')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {facilities.map((facility) => (
              <TableRow key={facility.code}>
                <TableCell>{facility.code}</TableCell>
                <TableCell>
                  {facility.silent ? (
                    <Tag type="red">{t('silent', 'Nothing for 3 days')}</Tag>
                  ) : facility.receivedLastDay > 0 ? (
                    <Tag type="green">{t('active', 'Sending')}</Tag>
                  ) : (
                    <Tag type="gray">{t('quiet', 'Nothing in the last day')}</Tag>
                  )}
                </TableCell>
                <TableCell>{facility.receivedLastDay}</TableCell>
                <TableCell>{facility.recordsReceived}</TableCell>
                <TableCell>
                  {facility.certificateExpires
                    ? formatDate(new Date(facility.certificateExpires * 1000), { time: false })
                    : t('unknown', 'Unknown')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
};

export default SyncStatus;
