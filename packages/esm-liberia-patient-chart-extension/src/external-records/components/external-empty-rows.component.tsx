import React from 'react';
import { EmptyDataIllustration } from '@openmrs/esm-patient-common-lib';
import styles from '../external-records.scss';

/** A section with no rows, styled like O3's own empty cards: pictogram, then centred text. */
const ExternalEmptyRows: React.FC<{ text: string }> = ({ text }) => (
  <div className={styles.emptyRows}>
    <span aria-hidden="true">
      <EmptyDataIllustration />
    </span>
    <p className={styles.emptyRowsText}>{text}</p>
  </div>
);

export default ExternalEmptyRows;
