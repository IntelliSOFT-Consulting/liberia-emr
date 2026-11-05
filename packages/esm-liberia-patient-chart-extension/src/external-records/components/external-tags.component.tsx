import React from 'react';
import { Tag } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import styles from '../external-records.scss';

/** EXTERNAL and READ ONLY, on every widget showing another facility's records; screen readers also hear what each means. */
const ExternalTags: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span className={styles.tags}>
      <Tag size="sm" type="purple" title={t('externalTagHint', 'Recorded at another facility')}>
        {t('externalTag', 'EXTERNAL')}
        <span className="cds--visually-hidden">: {t('externalTagHint', 'Recorded at another facility')}</span>
      </Tag>
      <Tag size="sm" type="gray" title={t('readOnlyTagHint', 'Cannot be changed here')}>
        {t('readOnlyTag', 'READ ONLY')}
        <span className="cds--visually-hidden">: {t('readOnlyTagHint', 'Cannot be changed here')}</span>
      </Tag>
    </span>
  );
};

export default ExternalTags;
