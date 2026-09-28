import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tag } from '@carbon/react';
import { formatDate } from '@openmrs/esm-framework';
import { type MflRun } from './mfl-sync.types';
import styles from './mfl-sync.scss';

export function when(millis: number | null | undefined) {
  return millis ? formatDate(new Date(millis)) : '';
}

export const RunStatusTag: React.FC<{ run: MflRun }> = ({ run }) => {
  const { t } = useTranslation();
  switch (run.status) {
    case 'RUNNING':
      return <Tag type="blue">{t('runRunning', 'Running')}</Tag>;
    case 'SUCCEEDED':
      return <Tag type="green">{t('runSucceeded', 'Succeeded')}</Tag>;
    case 'PARTIAL':
      return <Tag type="warm-gray">{t('runPartial', 'Partial')}</Tag>;
    default:
      return <Tag type="red">{t('runFailed', 'Failed')}</Tag>;
  }
};

export const RunCounts: React.FC<{ run: MflRun }> = ({ run }) => {
  const { t } = useTranslation();
  const { counts } = run;
  return (
    <span className={styles.counts}>
      {t(
        'runCounts',
        '{{created}} created, {{updated}} updated, {{retired}} retired, {{unretired}} restored, {{unchanged}} unchanged, {{failed}} failed, {{warnings}} with warnings',
        counts,
      )}
    </span>
  );
};
