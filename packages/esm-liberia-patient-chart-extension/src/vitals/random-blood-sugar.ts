export type RbsUnit = 'mg/dL' | 'mmol/L';

export interface RbsConceptPair {
  mgDl: string;
  mmol: string;
}

/** OpenMRS REST create uses this list. The legacy top-level provider property is not the contract. */
export interface RbsEncounterProvider {
  provider: string;
  encounterRole: string;
}

export interface RbsEncounter {
  patient: string;
  encounterType: string;
  encounterDatetime: string;
  location: string;
  visit?: string;
  encounterProviders: RbsEncounterProvider[];
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
 * webservices.rest 3.5 parses yyyy-MM-dd'T'HH:mm:ss.SSS±HH:mm.
 * The offset is this session's timezone, so the clock is not rewritten as UTC.
 */
export function formatOpenmrsEncounterDatetime(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const pad = (value: number, width = 2) => String(Math.trunc(Math.abs(value))).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
  );
}

/** Same choice as the form engine: the Clinician role, otherwise the first role returned. */
export function clinicianEncounterRole(roles: Array<{ uuid?: string; name?: string }> | undefined): string | null {
  const listed = (roles ?? []).filter((role) => role.uuid);
  return (listed.find((role) => role.name === 'Clinician') ?? listed[0])?.uuid ?? null;
}

/** Why a valid number still cannot be saved. Null when the encounter can be built. */
export function rbsEncounterMetadataError(input: {
  patientUuid?: string;
  encounterTypeUuid?: string;
  locationUuid?: string;
  providerUuid?: string;
  encounterRoleUuid?: string | null;
  encounterDatetime?: Date;
}): string | null {
  if (!input.patientUuid || !input.encounterTypeUuid || !input.locationUuid) {
    return 'The patient, location, or vitals encounter type is missing.';
  }
  if (!input.providerUuid) {
    return 'The logged-in user has no provider.';
  }
  if (!input.encounterRoleUuid) {
    return 'No encounter role is available.';
  }
  if (!formatOpenmrsEncounterDatetime(input.encounterDatetime ?? new Date(Number.NaN))) {
    return 'The encounter time could not be determined.';
  }
  return null;
}

/**
 * One vitals encounter and one observation. The concept is the unit.
 * An empty or invalid value, or missing encounter metadata, produces nothing.
 */
export function buildRbsEncounter(input: {
  patientUuid: string;
  encounterTypeUuid: string;
  locationUuid?: string;
  visitUuid?: string;
  providerUuid?: string;
  encounterRoleUuid?: string | null;
  encounterDatetime?: Date;
  unit: RbsUnit | '';
  raw: string;
  concepts: RbsConceptPair | null;
}): RbsEncounter | null {
  const encounterDatetime = input.encounterDatetime
    ? formatOpenmrsEncounterDatetime(input.encounterDatetime)
    : null;
  if (
    !input.patientUuid ||
    !input.encounterTypeUuid ||
    !input.locationUuid ||
    !input.providerUuid ||
    !input.encounterRoleUuid ||
    !encounterDatetime ||
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
    encounterDatetime,
    location: input.locationUuid,
    encounterProviders: [
      {
        provider: input.providerUuid,
        encounterRole: input.encounterRoleUuid,
      },
    ],
    obs: [
      {
        concept: input.unit === 'mg/dL' ? input.concepts.mgDl : input.concepts.mmol,
        value: Number(input.raw),
      },
    ],
  };
  if (input.visitUuid) {
    encounter.visit = input.visitUuid;
  }
  return encounter;
}
