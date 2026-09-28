import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink } from '@openmrs/esm-framework';
import { useMflStatus } from './mfl-sync.resource';

/**
 * The app menu entry. Absent where no MFL account is configured, which is every facility by
 * default (ADR 0009 decision 3), and for anyone without View MFL Sync, whose status request is refused.
 */
const MflSyncAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const { status } = useMflStatus();

  if (!status?.available) {
    return null;
  }

  return <ConfigurableLink to="${openmrsSpaBase}/mfl-sync">{t('mflSync', 'Master Facility List sync')}</ConfigurableLink>;
};

export default MflSyncAppMenuItem;
