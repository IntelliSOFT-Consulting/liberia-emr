/**
 * Same presentation rule as the patient-chart extension. Not authorization.
 * Matrix roles hold Get People; Clinician and Records Officer do not.
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
