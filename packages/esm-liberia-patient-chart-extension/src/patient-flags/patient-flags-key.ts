/** Matches the esm-patient-flags-app SWR key for one patient's stored flags. */
export function isPatientFlagsKey(key: unknown, restBaseUrl: string, patientUuid: string): boolean {
  return typeof key === 'string' && key.startsWith(`${restBaseUrl}/patientflags/patientflag?patient=${patientUuid}&`);
}

/** Changes when an encounter is added to or removed from the list, not on reorder or edit. */
export function encounterSignature(encounters: ReadonlyArray<{ uuid: string }>): string {
  return encounters
    .map((encounter) => encounter.uuid)
    .sort()
    .join(',');
}
