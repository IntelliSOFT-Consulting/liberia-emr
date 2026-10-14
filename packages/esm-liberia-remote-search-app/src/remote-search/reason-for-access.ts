/**
 * Reason for access (ADR 0007 condition 3, LE-387): asked before another facility's record is
 * imported, sent with the import and logged by the backend in liberiaemr_remote_history_fetch
 * with the user, patient and time.
 */
export type ReasonChoice = 'visitingPatient' | 'referralIn' | 'emergency' | 'other';

/** In the order the modal lists them. The labels are also what the audit log stores. */
export const reasonOptions: Array<{ id: ReasonChoice; translationKey: string; label: string }> = [
  { id: 'visitingPatient', translationKey: 'reasonVisitingPatient', label: 'Visiting patient' },
  { id: 'referralIn', translationKey: 'reasonReferralIn', label: 'Referral in' },
  { id: 'emergency', translationKey: 'reasonEmergency', label: 'Emergency' },
  { id: 'other', translationKey: 'reasonOther', label: 'Other' },
];

/** The backend keeps 255 characters; "Other: " takes 7 of them. */
export const maxReasonDetailsLength = 248;

/** A reason can be sent once one is chosen; "Other" also needs the details typed. */
export function isValidReason(choice: ReasonChoice | null | undefined, details: string | null | undefined): boolean {
  if (!choice) {
    return false;
  }
  return choice !== 'other' || Boolean(details?.trim());
}

/**
 * The text logged for the access. It is the English label, not the translated one, so the audit
 * log reads the same whatever language the user works in.
 */
export function formatReason(choice: ReasonChoice, details?: string): string {
  const option = reasonOptions.find((candidate) => candidate.id === choice);
  if (!option) {
    throw new Error(`Unknown reason for access: ${choice}`);
  }
  if (choice === 'other') {
    return `${option.label}: ${(details ?? '').trim().slice(0, maxReasonDetailsLength)}`;
  }
  return option.label;
}
