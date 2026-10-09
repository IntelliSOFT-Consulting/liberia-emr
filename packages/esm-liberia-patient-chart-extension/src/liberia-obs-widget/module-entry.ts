/**
 * Whether a chart entry should be shown. This is presentation only.
 * `hasPrivilege` is `userHasAccess`, so a System Developer still sees the entry
 * and a missing privilege still fails closed. Matrix roles hold Get People;
 * Clinician and Records Officer do not, and keep the chart they already had.
 */
export function moduleEntryVisible(
  hasPrivilege: (name: string) => boolean,
  readPrivilege = '',
  writePrivilege = '',
): boolean {
  if ((readPrivilege && hasPrivilege(readPrivilege)) || (writePrivilege && hasPrivilege(writePrivilege))) {
    return true;
  }
  if (!readPrivilege && !writePrivilege) {
    return true;
  }
  return !hasPrivilege('Get People');
}
