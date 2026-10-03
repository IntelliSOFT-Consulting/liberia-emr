import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink, useSession, userHasAccess } from '@openmrs/esm-framework';
import { useSyncStatus } from './sync-status.resource';
import { VIEW_SYNC_STATUS } from '../privileges';

/**
 * The app menu entry. Absent on a facility server, where the backend reports the feature off, and
 * for anyone without View Sync Status. The app shell already skips the entry for them, from the
 * privilege in routes.json; this check reads the same privilege from the same file
 * (src/privileges.ts) and keeps the status request from being sent at all.
 */
const SyncStatusAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const session = useSession();
  const permitted = Boolean(session?.user) && userHasAccess(VIEW_SYNC_STATUS, session.user);
  const { status } = useSyncStatus(permitted);

  if (!permitted || !status?.enabled) {
    return null;
  }

  return (
    <ConfigurableLink to="${openmrsSpaBase}/sync-status">{t('syncStatus', 'Sync status')}</ConfigurableLink>
  );
};

export default SyncStatusAppMenuItem;
