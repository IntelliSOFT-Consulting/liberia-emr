import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type ReportsConfig } from '../config-schema';

/**
 * The app menu entry, for holders of Export National Report only. routes.json declares the same
 * privilege, so the app shell does not mount it otherwise; this check keeps the rule when the
 * privilege is re-configured, and in tests.
 */
const ReportsAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const { exportPrivilege } = useConfig<ReportsConfig>();
  const session = useSession();

  if (!session?.user || !userHasAccess(exportPrivilege, session.user)) {
    return null;
  }

  return (
    <ConfigurableLink to="${openmrsSpaBase}/indicator-reports">{t('indicatorReports', 'Indicator reports')}</ConfigurableLink>
  );
};

export default ReportsAppMenuItem;
