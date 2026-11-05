import React, { useEffect, useRef } from 'react';
import { Loading, ModalBody, Tag } from '@carbon/react';
import { CheckmarkFilled } from '@carbon/react/icons';
import { useStore } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { importProgressStore, progressPercent, type StepState } from './run-import';
import styles from './import-progress.scss';

export interface ImportProgressProps {
  patientName: string;
  /** e.g. "29 Years"; left out when unknown. */
  age?: string;
  /** e.g. "11-Jan-1997"; left out when unknown. */
  birthdate?: string;
  /** e.g. "OpenMRS ID: 1001396". */
  identifier?: string;
}

const steps = [
  { key: 'importStepConnecting', label: 'Connecting to National Registry...' },
  { key: 'importStepFetching', label: 'Fetching Patient Record...' },
  { key: 'importStepImporting', label: 'Importing to local system' },
];

const StepIcon: React.FC<{ state: StepState }> = ({ state }) => {
  if (state === 'done') {
    return <CheckmarkFilled size={16} className={styles.stepDone} aria-hidden="true" />;
  }
  if (state === 'active') {
    // Hidden: Loading is an assertive live region; the step text is announced instead.
    return (
      <span aria-hidden="true">
        <Loading small withOverlay={false} className={styles.stepActive} description="" />
      </span>
    );
  }
  return <span className={styles.stepPending} aria-hidden="true" />;
};

/** "IMPORTING RECORD" (mockup 2c). Not dismissible: no close button, and Escape is blocked while shown. */
const ImportProgress: React.FC<ImportProgressProps> = ({ patientName, age, birthdate, identifier }) => {
  const { t } = useTranslation();
  const { steps: states } = useStore(importProgressStore);
  const percent = progressPercent(states);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeIndex = states.findIndex((state) => state === 'active');
  const activeLabel = activeIndex >= 0 ? t(steps[activeIndex].key, steps[activeIndex].label) : '';
  const stateLabels: Record<StepState, string> = {
    done: t('importStepDone', 'done'),
    active: t('importStepActive', 'in progress'),
    pending: t('importStepPending', 'not started'),
  };

  // The Import & Open button that had focus is gone; keep focus inside the modal.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    // Capture runs before the modal system's bubbling Escape listener on window.
    const blockEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', blockEscape, true);
    return () => window.removeEventListener('keydown', blockEscape, true);
  }, []);

  const details = [age, birthdate].filter(Boolean);

  return (
    <div className={styles.dialog} ref={dialogRef} tabIndex={-1} aria-busy="true">
      <div className={styles.header}>
        <span className={styles.eyebrow}>{t('importingRecord', 'IMPORTING RECORD')}</span>
        <h3 className={styles.patientName}>{patientName}</h3>
        <div className={styles.patientDetails}>
          {details.map((detail, index) => (
            <React.Fragment key={detail}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <span>{detail}</span>
            </React.Fragment>
          ))}
          {identifier && (
            <>
              {details.length > 0 && <span aria-hidden="true">·</span>}
              <Tag size="sm" type="gray" className={styles.identifier}>
                {identifier}
              </Tag>
            </>
          )}
        </div>
      </div>
      <ModalBody className={styles.body}>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.key} className={styles.step} aria-current={states[index] === 'active' ? 'step' : undefined}>
              <StepIcon state={states[index]} />
              <span>{t(step.key, step.label)}</span>
              <span className="cds--visually-hidden"> ({stateLabels[states[index]]})</span>
            </li>
          ))}
        </ol>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={t('importProgress', 'Import progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={activeLabel ? `${percent}% · ${activeLabel}` : `${percent}%`}
        >
          <div className={styles.progressBar} style={{ width: `${percent}%` }} />
        </div>
        <p className="cds--visually-hidden" aria-live="polite">
          {activeLabel}
        </p>
      </ModalBody>
    </div>
  );
};

export default ImportProgress;
