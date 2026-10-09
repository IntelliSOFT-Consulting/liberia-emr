import React from 'react';
import { ActionableNotification, Button, Layer, Tile } from '@carbon/react';
import { EmptyDataIllustration } from '@openmrs/esm-patient-common-lib';
import { useTranslation } from 'react-i18next';
import type { ExternalRecordsStatus } from '../external-records';
import { statusDisplay } from '../external-records-sections';
import { formatAsOf } from '../format-as-of';
import { dateHelpers } from '../use-external-records';
import styles from '../external-records.scss';

interface ExternalRecordsStatusProps {
  status: ExternalRecordsStatus;
  asOf: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/** The As of / Refresh bar over the data, or the empty state in its place (6a–6f). Card and dashboard share it. */
const ExternalRecordsStatusView: React.FC<ExternalRecordsStatusProps> = ({ status, asOf, isRefreshing, onRefresh }) => {
  const { t } = useTranslation();
  const display = statusDisplay(status, asOf ? formatAsOf(asOf, new Date(), dateHelpers(), t) : '', t);
  const busyLabel = display.type === 'bar' ? t('refreshing', 'Refreshing…') : t('retrying', 'Retrying…');
  const action = isRefreshing ? busyLabel : display.action;

  if (display.type === 'bar') {
    return (
      <ActionableNotification
        inline
        lowContrast
        hideCloseButton
        kind={display.kind}
        title={display.title}
        subtitle={display.subtitle}
        actionButtonLabel={action}
        onActionButtonClick={isRefreshing ? undefined : onRefresh}
        className={styles.statusBar}
      />
    );
  }

  return (
    <Layer>
      <Tile className={styles.emptyState}>
        <EmptyDataIllustration />
        <p className={styles.emptyTitle}>{display.title}</p>
        <p className={styles.emptyBody}>{display.body}</p>
        <Button kind="tertiary" size="sm" className={styles.centredButton} onClick={onRefresh} disabled={isRefreshing}>
          {action}
        </Button>
      </Tile>
    </Layer>
  );
};

export default ExternalRecordsStatusView;
