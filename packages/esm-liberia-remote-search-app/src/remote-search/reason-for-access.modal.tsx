import React, { useState } from 'react';
import { Button, ModalBody, ModalFooter, ModalHeader, RadioButton, RadioButtonGroup, TextInput } from '@carbon/react';
import { useTranslation } from 'react-i18next';
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
  /** Called with the reason to log once the user confirms. Cancel never calls it. */
  onConfirm: (reason: string) => void;
}

/** "Why are you opening this record?", asked by Import & Open before anything is sent (mockups 2a, 2b). */
const ReasonForAccessModal: React.FC<ReasonForAccessModalProps> = ({ close, onConfirm }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ReasonChoice | null>(null);
  const [details, setDetails] = useState('');
  const canConfirm = isValidReason(choice, details);

  const confirm = () => {
    if (!canConfirm) return;
    const reason = formatReason(choice, details);
    close();
    onConfirm(reason);
  };

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
