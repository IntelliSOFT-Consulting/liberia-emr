import React from 'react';
import { Tag } from '@carbon/react';
import { ConfigurableLink } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { dashboardUrl } from './external-records-config';
import { useExternalRecords } from './use-external-records';
import styles from './external-records.scss';

interface BannerTagProps {
  patientUuid: string;
  /** The banner is also used in search results; only the chart's shows this tag. */
  renderedFrom?: string;
}

/** "Records from other facilities (N)" in the patient banner (4a); hidden when N is 0 (6f). */
const ExternalRecordsBannerTag: React.FC<BannerTagProps> = ({ patientUuid, renderedFrom }) => {
  const inSearch = Boolean(renderedFrom?.toLowerCase().includes('search'));
  return inSearch ? null : <BannerTag patientUuid={patientUuid} />;
};

const BannerTag: React.FC<{ patientUuid: string }> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const { isImported, facilities } = useExternalRecords(patientUuid);

  if (!isImported || facilities.length === 0) {
    return null;
  }
  return (
    <ConfigurableLink to={dashboardUrl(patientUuid)} className={styles.bannerTagLink}>
      <Tag type="purple" size="md">
        {t('recordsFromOtherFacilities', 'Records from other facilities ({{count}})', { count: facilities.length })}
      </Tag>
    </ConfigurableLink>
  );
};

export default ExternalRecordsBannerTag;
