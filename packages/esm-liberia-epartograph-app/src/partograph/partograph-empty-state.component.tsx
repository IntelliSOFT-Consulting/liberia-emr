import React from 'react';
import { Button, Layer, Tile } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { EmptyDataIllustration } from '@openmrs/esm-patient-common-lib';
import { useLayoutType } from '@openmrs/esm-framework';
import styles from './partograph-empty-state.scss';

export interface PartographEmptyStateProps {
  headerTitle?: string;
  message?: string;
  launchForm?: () => void;
  buttonText?: string;
}

export const PartographEmptyState: React.FC<PartographEmptyStateProps> = ({
  headerTitle,
  message,
  launchForm,
  buttonText,
}) => {
  const { t } = useTranslation();
  const isTablet = useLayoutType() === 'tablet';

  return (
    <Layer className={styles.layer}>
      <Tile className={styles.tile}>
        <div className={isTablet ? styles.tabletHeading : styles.desktopHeading}>
          <h4>{headerTitle || t('partograph', 'Partograph')}</h4>
        </div>
        <EmptyDataIllustration />
        <p className={styles.content}>
          {message || t('noPartographToDisplay', 'There are no Partograph to display for this patient')}
        </p>
        {launchForm && (
          <p className={styles.action}>
            <Button onClick={launchForm} kind="ghost" size={isTablet ? 'lg' : 'sm'}>
              {buttonText || t('recordPartograph', 'Record Partograph')}
            </Button>
          </p>
        )}
      </Tile>
    </Layer>
  );
};

export default PartographEmptyState;
