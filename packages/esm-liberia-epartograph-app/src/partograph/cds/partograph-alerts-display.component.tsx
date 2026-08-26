import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionableNotification, InlineNotification } from '@carbon/react';
import type { PartographAlertResult } from './use-partograph-alerts';
import type { EPartographConfig } from '../../config-schema';
import styles from '../partograph-main.scss';

interface PartographAlertsDisplayProps {
  alerts: PartographAlertResult;
  config: EPartographConfig;
  onLaunchForm: () => void;
}

/**
 * PartographAlertsDisplay
 *
 * Renders the Carbon InlineNotification/ActionableNotification toasts that
 * correspond to the four WHO CDS states detected by usePartographAlerts:
 *
 *  - 'action': Red  — "Action Line Reached" — Immediate clinical action required.
 *  - 'alert':  Yellow — "Labour Progress Requires Review" — Alert Line crossed.
 *  - 'due':    Blue — "Partograph Update Due" — Assessment interval exceeded.
 *  - 'normal': Green — "Labour Progress Normal" — All clear.
 *  - 'none':   Nothing rendered (no data yet).
 *
 * Matches the exact designs provided.
 */
const PartographAlertsDisplay: React.FC<PartographAlertsDisplayProps> = ({ alerts, onLaunchForm }) => {
  const { t } = useTranslation();

  const handleUpdatePartograph = useCallback(() => {
    onLaunchForm();
  }, [onLaunchForm]);

  if (alerts.status === 'none') {
    return null;
  }

  if (alerts.status === 'action') {
    return (
      <div className={styles.alertContainer}>
        <InlineNotification
          kind="error"
          title={t('actionLineReached', 'Action Line Reached')}
          subtitle={t(
            'actionLineReachedSubtitle',
            'Cervical dilatation has reached the Action Line. Immediate clinical review and a decision on further management are required.',
          )}
          lowContrast
        />
      </div>
    );
  }

  if (alerts.status === 'alert') {
    return (
      <div className={styles.alertContainer}>
        <ActionableNotification
          kind="warning"
          title={t('labourProgressRequiresReview', 'Labour Progress Requires Review')}
          subtitle={t(
            'labourProgressRequiresReviewSubtitle',
            'Cervical dilatation is progressing more slowly than expected and has moved beyond the Alert Line. Review labour progress and maternal and fetal wellbeing.',
          )}
          actionButtonLabel={t('reviewLabourProgress', 'Review Labour Progress')}
          onActionButtonClick={handleUpdatePartograph}
          lowContrast
        />
      </div>
    );
  }

  if (alerts.status === 'due') {
    return (
      <div className={styles.alertContainer}>
        <ActionableNotification
          kind="info"
          title={t('partographUpdateDue', 'Partograph Update Due')}
          subtitle={t(
            'partographUpdateDueSubtitle',
            'The next labour assessment is due. Please record the required maternal and fetal observations in the partograph.',
          )}
          actionButtonLabel={t('updatePartograph', 'Update Partograph')}
          onActionButtonClick={handleUpdatePartograph}
          lowContrast
        />
      </div>
    );
  }

  // status === 'normal'
  return (
    <div className={styles.alertContainer}>
      <ActionableNotification
        kind="success"
        title={t('labourProgressNormal', 'Labour Progress Normal')}
        subtitle={t(
          'labourProgressNormalSubtitle',
          'Cervical dilatation is progressing as expected and remains on or to the left of the Alert Line. Continue routine monitoring.',
        )}
        actionButtonLabel={t('viewLabourProgress', 'View Labour Progress')}
        onActionButtonClick={handleUpdatePartograph}
        lowContrast
      />
    </div>
  );
};

export default PartographAlertsDisplay;
