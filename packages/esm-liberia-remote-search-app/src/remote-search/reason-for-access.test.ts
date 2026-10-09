import { formatReason, isValidReason, maxReasonDetailsLength, reasonOptions } from './reason-for-access';

describe('reason for access', () => {
  it('offers the four reasons in the order of the design', () => {
    expect(reasonOptions.map((option) => option.label)).toEqual([
      'Visiting patient',
      'Referral in',
      'Emergency',
      'Other',
    ]);
  });

  it('is invalid until a reason is chosen', () => {
    expect(isValidReason(null, '')).toBe(false);
    expect(isValidReason(undefined, 'anything')).toBe(false);
  });

  it('accepts the fixed reasons without details', () => {
    expect(isValidReason('visitingPatient', '')).toBe(true);
    expect(isValidReason('referralIn', undefined)).toBe(true);
    expect(isValidReason('emergency', null)).toBe(true);
  });

  it('needs details for Other, and blank details do not count', () => {
    expect(isValidReason('other', '')).toBe(false);
    expect(isValidReason('other', '   ')).toBe(false);
    expect(isValidReason('other', 'Seen at outreach session')).toBe(true);
  });

  it('logs the English label of a fixed reason, ignoring any details', () => {
    expect(formatReason('visitingPatient')).toBe('Visiting patient');
    expect(formatReason('referralIn', 'ignored')).toBe('Referral in');
    expect(formatReason('emergency')).toBe('Emergency');
  });

  it('logs Other with its trimmed details', () => {
    expect(formatReason('other', '  Seen at outreach session; needs ANC record ')).toBe(
      'Other: Seen at outreach session; needs ANC record',
    );
  });

  it('keeps Other within the 255 characters the audit table stores', () => {
    const reason = formatReason('other', 'x'.repeat(400));
    expect(reason).toHaveLength('Other: '.length + maxReasonDetailsLength);
    expect(reason.length).toBeLessThanOrEqual(255);
  });
});
