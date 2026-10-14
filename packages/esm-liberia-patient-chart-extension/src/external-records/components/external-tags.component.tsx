import React from 'react';
import { Tag } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import styles from '../external-records.scss';

/** EXTERNAL and READ ONLY, on every widget showing another facility's records. */
const ExternalTags: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span className={styles.tags}>
      <Tag size="sm" type="purple" title={t('externalTagHint', 'Recorded at another facility')}>
        {t('externalTag', 'EXTERNAL')}
      </Tag>
      <Tag size="sm" type="gray" title={t('readOnlyTagHint', 'Cannot be changed here')}>
        {t('readOnlyTag', 'READ ONLY')}
      </Tag>
    </span>
  );
};

export default ExternalTags;
