import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink, useSession, userHasAccess } from '@openmrs/esm-framework';
import { useMflStatus } from './mfl-sync.resource';
import { VIEW_MFL_SYNC } from '../privileges';

/**
 * The app menu entry. Absent where no MFL account is configured, which is every facility by
 * default (ADR 0009 decision 3), and for anyone without View MFL Sync. The app shell already skips
 * the entry for them, from the privilege in routes.json; this check reads the same privilege from
 * the same file (src/privileges.ts) and keeps the status request from being sent at all, since the
 * server would only refuse it.
 */
const MflSyncAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const session = useSession();
  const permitted = Boolean(session?.user) && userHasAccess(VIEW_MFL_SYNC, session.user);
  const { status } = useMflStatus(permitted);

  if (!permitted || !status?.available) {
    return null;
  }

  return <ConfigurableLink to="${openmrsSpaBase}/mfl-sync">{t('mflSync', 'Master Facility List sync')}</ConfigurableLink>;
};

export default MflSyncAppMenuItem;
