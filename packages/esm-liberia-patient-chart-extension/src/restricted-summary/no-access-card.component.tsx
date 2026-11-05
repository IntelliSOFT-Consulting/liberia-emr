import React from 'react';
import { useTranslation } from 'react-i18next';
import { CardHeader } from '@openmrs/esm-patient-common-lib';
import styles from './no-access-card.scss';

interface NoAccessCardProps {
  title: string;
}

/** Plain denial. A server failure still uses ErrorState. */
const NoAccessCard: React.FC<NoAccessCardProps> = ({ title }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <CardHeader title={title}>{null}</CardHeader>
      <p className={styles.message}>{t('noAccess', 'You do not have access to this data.')}</p>
    </div>
  );
};

export default NoAccessCard;
