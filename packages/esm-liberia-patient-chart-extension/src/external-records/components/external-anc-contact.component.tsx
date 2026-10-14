import React from 'react';
import { formatDate } from '@openmrs/esm-framework';
import { CardHeader } from '@openmrs/esm-patient-common-lib';
import { useTranslation } from 'react-i18next';
import type { ExternalAncContact } from '../external-records';
import { formatGestationalAge } from '../external-records-sections';
import ExternalEmptyRows from './external-empty-rows.component';
import styles from '../external-records.scss';

interface ExternalAncContactProps {
  contact: ExternalAncContact | null;
  facilityLabel?: string;
}

const day = (iso?: string) => (iso ? formatDate(new Date(iso), { time: false, noToday: true }) : '');

/** Last ANC contact (5a): gestational age, risk flags, next contact, date and facility. */
const ExternalAncContactCard: React.FC<ExternalAncContactProps> = ({ contact, facilityLabel }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.widget}>
      <CardHeader title={t('lastAncContact', 'Last ANC contact')}>{null}</CardHeader>
      {!contact ? (
        <ExternalEmptyRows
          text={t('noSectionRowsAt', 'No {{section}} recorded at {{facility}}', {
            section: t('ancContactNoun', 'ANC contact'),
            facility: facilityLabel ?? t('otherFacilities', 'other facilities'),
          })}
        />
      ) : (
        <dl className={styles.keyValues}>
          {[
            [t('gestationalAge', 'Gestational age'), formatGestationalAge(contact.gestationalAgeWeeks, t)],
            [t('riskFlags', 'Risk flags'), contact.riskFlags.join(', ') || t('none', 'None')],
            [t('nextScheduledContact', 'Next scheduled contact'), day(contact.nextContactDate)],
            [t('contactDate', 'Contact date'), day(contact.contactDate)],
            [t('facility', 'Facility'), contact.facility.name ?? t('unknownFacility', 'Unknown facility')],
          ].map(([label, value]) => (
            <div key={label} className={styles.keyValue}>
              <dt>{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default ExternalAncContactCard;
