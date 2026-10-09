import React, { useState } from 'react';
import { Button, ModalBody, ModalFooter, ModalHeader, RadioButton, RadioButtonGroup, TextInput } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import ImportProgress, { type ImportProgressProps } from './import-progress.component';
import {
  formatReason,
  isValidReason,
  maxReasonDetailsLength,
  reasonOptions,
  type ReasonChoice,
} from './reason-for-access';
import styles from './reason-for-access.scss';

export interface ReasonForAccessModalProps {
  close: () => void;
  /** Called with the reason once confirmed; never on Cancel. With `progress`, the caller closes the modal. */
  onConfirm: (reason: string, close: () => void) => void;
  /** Show the import progress in this modal after confirming, instead of closing. */
  progress?: ImportProgressProps;
}

/** "Why are you opening this record?", asked by Import & Open before anything is sent (mockups 2a, 2b). */
const ReasonForAccessModal: React.FC<ReasonForAccessModalProps> = ({ close, onConfirm, progress }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ReasonChoice | null>(null);
  const [details, setDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const canConfirm = isValidReason(choice, details);

  const confirm = () => {
    if (!canConfirm) return;
    const reason = formatReason(choice, details);
    // One modal throughout: opening a second one while this closes renders it twice (O3 modal race).
    if (progress) {
      setConfirmed(true);
    } else {
      close();
    }
    onConfirm(reason, close);
  };

  if (confirmed && progress) {
    return <ImportProgress {...progress} />;
  }

  return (
    <>
      <ModalHeader closeModal={close} title={t('reasonForAccessTitle', 'Why are you opening this record?')} />
      <ModalBody>
        <form
          id="liberia-reason-for-access"
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <RadioButtonGroup
            legendText={t('reasonForAccess', 'Reason for access')}
            name="reason-for-access"
            orientation="vertical"
            valueSelected={choice ?? undefined}
            onChange={(value) => setChoice(value as ReasonChoice)}
          >
            {reasonOptions.map((option) => (
              <RadioButton
                key={option.id}
                id={`reason-for-access-${option.id}`}
                value={option.id}
                labelText={t(option.translationKey, option.label)}
              />
            ))}
          </RadioButtonGroup>
          {choice === 'other' && (
            <div className={styles.otherDetails}>
              <TextInput
                id="reason-for-access-details"
                labelText={t('reasonDetails', 'Describe the reason')}
                value={details}
                maxLength={maxReasonDetailsLength}
                onChange={(event) => setDetails(event.target.value)}
                autoFocus
              />
            </div>
          )}
          <p className={styles.recordedNotice}>
            {t('reasonRecordedNotice', 'Your name, the reason and the time of this access are recorded.')}
          </p>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button kind="secondary" onClick={close}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button kind="primary" type="submit" form="liberia-reason-for-access" disabled={!canConfirm}>
          {t('importAndOpen', 'Import & Open')}
        </Button>
      </ModalFooter>
    </>
  );
};

export default ReasonForAccessModal;
