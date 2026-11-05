/** HTTP statuses that mean the caller is not allowed to see the data. */
export function isPermissionDenied(error: unknown): boolean {
  const candidate = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = candidate?.response?.status ?? candidate?.status;
  return status === 401 || status === 403;
}

export interface RestrictedSection {
  id: 'vitals' | 'biometrics' | 'conditions';
  title: string;
}

const OBSERVATIONS = 'Get Observations';
const CONDITIONS = 'Get Concepts';

/**
 * Patient Summary cards whose upstream widgets call FHIR with a privilege Registrar does not hold.
 * Get Observations is the FHIR Observation search. Get Concepts is the FHIR Condition search.
 */
export function restrictedSummarySections(hasPrivilege: (name: string) => boolean): RestrictedSection[] {
  const sections: RestrictedSection[] = [];
  if (!hasPrivilege(OBSERVATIONS)) {
    sections.push({ id: 'vitals', title: 'Vitals' }, { id: 'biometrics', title: 'Biometrics' });
  }
  if (!hasPrivilege(CONDITIONS)) {
    sections.push({ id: 'conditions', title: 'Conditions' });
  }
  return sections;
}
