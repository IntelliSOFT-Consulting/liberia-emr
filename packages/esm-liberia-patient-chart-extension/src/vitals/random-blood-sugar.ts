export type RbsUnit = 'mg/dL' | 'mmol/L';

export interface RbsConceptPair {
  mgDl: string;
  mmol: string;
}

export interface RbsEncounter {
  patient: string;
  encounterType: string;
  location?: string;
  visit?: string;
  obs: Array<{ concept: string; value: number }>;
}

/** Empty is incomplete, not an error. mg/dL is a whole number from 0 to 600. mmol/L is from 0 to 33.3. */
export function validateRbsValue(unit: RbsUnit | '', raw: string): string | null {
  if (raw.trim() === '') {
    return null;
  }
  if (!unit) {
    return 'Choose mg/dL or mmol/L.';
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return unit === 'mg/dL'
      ? 'Initial blood sugar in mg/dL must be a whole number.'
      : 'Initial blood sugar must be between 0 and 33.3 mmol/L.';
  }
  if (unit === 'mg/dL') {
    if (value % 1 !== 0) {
      return 'Initial blood sugar in mg/dL must be a whole number.';
    }
    if (value < 0 || value > 600) {
      return 'Initial blood sugar must be between 0 and 600 mg/dL.';
    }
    return null;
  }
  if (value < 0 || value > 33.3) {
    return 'Initial blood sugar must be between 0 and 33.3 mmol/L.';
  }
  return null;
}

/** The history column already lists CIEL 887 as mg/dL and CIEL 1458 as mmol/L. */
export function rbsConceptPair(
  columns: Array<{ concepts?: Array<{ concept?: string; unit?: string }> }> | undefined,
): RbsConceptPair | null {
  const listed = columns?.[0]?.concepts ?? [];
  const mgDl = listed.find((item) => item.unit === 'mg/dL')?.concept;
  const mmol = listed.find((item) => item.unit === 'mmol/L')?.concept;
  if (!mgDl || !mmol) {
    return null;
  }
  return { mgDl, mmol };
}

/**
 * One vitals encounter and one observation. The concept is the unit.
 * An empty or invalid value produces nothing.
 */
export function buildRbsEncounter(input: {
  patientUuid: string;
  encounterTypeUuid: string;
  locationUuid?: string;
  visitUuid?: string;
  unit: RbsUnit | '';
  raw: string;
  concepts: RbsConceptPair | null;
}): RbsEncounter | null {
  if (
    !input.patientUuid ||
    !input.encounterTypeUuid ||
    !input.locationUuid ||
    !input.concepts ||
    !input.unit ||
    input.raw.trim() === ''
  ) {
    return null;
  }
  if (validateRbsValue(input.unit, input.raw)) {
    return null;
  }
  const encounter: RbsEncounter = {
    patient: input.patientUuid,
    encounterType: input.encounterTypeUuid,
    obs: [
      {
        concept: input.unit === 'mg/dL' ? input.concepts.mgDl : input.concepts.mmol,
        value: Number(input.raw),
      },
    ],
  };
  encounter.location = input.locationUuid;
  if (input.visitUuid) {
    encounter.visit = input.visitUuid;
  }
  return encounter;
}
