import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink, useSession, userHasAccess } from '@openmrs/esm-framework';
import { EXPORT_PRIVILEGE } from '../privileges';

/**
 * The app menu entry, for holders of Export National Report only. The app shell already skips it
 * for anyone else, from the privilege in routes.json; this check reads the same privilege from the
 * same file (src/privileges.ts), so the two cannot disagree, and keeps the rule in tests.
 */
const ReportsAppMenuItem: React.FC = () => {
  const { t } = useTranslation();
  const session = useSession();

  if (!session?.user || !userHasAccess(EXPORT_PRIVILEGE, session.user)) {
    return null;
  }

  return (
    <ConfigurableLink to="${openmrsSpaBase}/indicator-reports">{t('indicatorReports', 'Indicator reports')}</ConfigurableLink>
  );
};

export default ReportsAppMenuItem;
