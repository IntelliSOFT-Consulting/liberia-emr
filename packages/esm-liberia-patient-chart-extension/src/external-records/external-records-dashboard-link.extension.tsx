import React, { useMemo } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardExtension, type IconId } from '@openmrs/esm-styleguide';
import { useConfig } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { externalRecordsDashboardPath, type ExternalRecordsConfig } from './external-records-config';
import { useExternalRecords } from './use-external-records';

interface DashboardLinkProps {
  basePath: string;
}

/** "External records" in the chart's left nav, below Visits (4a, 4c); only for an imported patient. */
const ExternalRecordsDashboardLink: React.FC<DashboardLinkProps> = ({ basePath }) => {
  const { t } = useTranslation();
  const patientUuid = useMemo(() => basePath?.match(/patient\/([0-9a-fA-F-]+)/)?.[1] ?? '', [basePath]);
  const { isImported } = useExternalRecords(patientUuid);
  const { externalRecords: config } = useConfig<{ externalRecords: ExternalRecordsConfig }>();

  if (!isImported) {
    return null;
  }
  return (
    <BrowserRouter>
      <DashboardExtension
        basePath={basePath}
        path={externalRecordsDashboardPath}
        title={t('externalRecords', 'External records')}
        icon={config.dashboardIcon as IconId}
      />
    </BrowserRouter>
  );
};

export default ExternalRecordsDashboardLink;
