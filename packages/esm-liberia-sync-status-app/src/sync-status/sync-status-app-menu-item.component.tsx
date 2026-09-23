import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink } from '@openmrs/esm-framework';
import { useSyncStatus } from './sync-status.resource';

/**
 * The app menu entry. Absent on a facility server, where the backend reports the feature off.
 */
const SyncStatusAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const { status } = useSyncStatus();

  if (!status?.enabled) {
    return null;
  }

  return (
    <ConfigurableLink to="${openmrsSpaBase}/sync-status">{t('syncStatus', 'Sync status')}</ConfigurableLink>
  );
};

export default SyncStatusAppMenuItem;
