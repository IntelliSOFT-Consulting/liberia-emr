import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PersistentNotification } from '../../components/persistent-notification';
import type { PartographAlertResult } from './use-partograph-alerts';
import type { EPartographConfig } from '../../config-schema';

interface PartographAlertsDisplayProps {
  alerts: PartographAlertResult;
  config: EPartographConfig;
  onLaunchForm: () => void;
}

/**
 * PartographAlertsDisplay
 *
 * Renders the WHO Partograph CDS alerts using the generic PersistentNotification component.
 */
const PartographAlertsDisplay: React.FC<PartographAlertsDisplayProps> = ({ alerts, onLaunchForm }) => {
  const { t } = useTranslation();

  const handleUpdatePartograph = useCallback(() => {
    onLaunchForm();
  }, [onLaunchForm]);

  if (alerts.status === 'none') {
    return null;
  }

  let kind: 'error' | 'warning' | 'info' | 'success' = 'info';
  let title = '';
  let subtitle = '';
  let actionLabel = '';

  switch (alerts.status) {
    case 'action':
      kind = 'error';
      title = t('actionLineReached', 'Action Line Reached');
      subtitle = t(
        'actionLineReachedSubtitle',
        'Cervical dilatation has reached the Action Line. Immediate clinical review and a decision on further management are required.',
      );
      actionLabel = t('reviewLabourProgress', 'Review Labour Progress');
      break;

    case 'alert':
      kind = 'warning';
      title = t('labourProgressRequiresReview', 'Labour Progress Requires Review');
      subtitle = t(
        'labourProgressRequiresReviewSubtitle',
        'Cervical dilatation is progressing more slowly than expected and has moved beyond the Alert Line. Review labour progress and maternal and fetal wellbeing.',
      );
      actionLabel = t('reviewLabourProgress', 'Review Labour Progress');
      break;

    case 'due':
      kind = 'info';
      title = t('partographUpdateDue', 'Partograph Update Due');
      subtitle = t(
        'partographUpdateDueSubtitle',
        'The next labour assessment is due. Please record the required maternal and fetal observations in the partograph.',
      );
      actionLabel = t('updatePartograph', 'Update Partograph');
      break;

    case 'normal':
      kind = 'success';
      title = t('labourProgressNormal', 'Labour Progress Normal');
      subtitle = t(
        'labourProgressNormalSubtitle',
        'Cervical dilatation is progressing as expected and remains on or to the left of the Alert Line. Continue routine monitoring.',
      );
      actionLabel = t('viewLabourProgress', 'View Labour Progress');
      break;

    case 'delivered':
      kind = 'success';
      title = t('labourConcluded', 'Labour Concluded');
      subtitle = t(
        'labourConcludedSubtitle',
        'Delivery has been recorded. Active intrapartum monitoring is complete.',
      );
      actionLabel = '';
      break;
  }

  return (
    <PersistentNotification
      kind={kind}
      title={title}
      subtitle={subtitle}
      actionButtonLabel={actionLabel}
      onActionButtonClick={handleUpdatePartograph}
      notificationKey={alerts.status}
    />
  );
};

export default PartographAlertsDisplay;
