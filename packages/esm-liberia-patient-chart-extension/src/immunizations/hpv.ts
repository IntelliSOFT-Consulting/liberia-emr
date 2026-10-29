import { clinicalDate } from './clinical-date.ts';
import { encountersOmittingEditingVaccine, type FhirImmunization, type NationalEncounter } from './history.ts';
import { loadHistory, sequenceHistoryUrls } from './load-history.ts';
import { historyBelongsToPatient } from './pediatric-pfizer.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { evaluateSequence, type SequenceStatus } from './sequence.ts';

/**
 * HPV save decision for the national Immunization form.
 * Dose identity comes from the form's ${var.*} arguments and must match
 * runtime routineImmunizations config. Age, interval, duplicate, and
 * unresolved history come from evaluateSequence. Sex is patient.gender,
 * lower-cased, and is female when that value is "female" or "f". This module
 * does not write encounters and does not define a second HPV schedule.
 */
export type HpvGateCode =
  | 'allowed'
  | 'not-female'
  | 'not-yet-due'
  | 'not-eligible'
  | 'waiting-for-prerequisite'
  | 'waiting-for-interval'
  | 'due'
  | 'overdue'
  | 'already-given'
  | 'unresolved';

export type HpvDoseId = 'HPV1' | 'HPV2';

const STATUS_CODE: Record<SequenceStatus, HpvGateCode> = {
  NOT_YET_DUE: 'not-yet-due',
  NOT_ELIGIBLE: 'not-eligible',
  WAITING_FOR_PREREQUISITE: 'waiting-for-prerequisite',
  WAITING_FOR_INTERVAL: 'waiting-for-interval',
  DUE: 'due',
  OVERDUE: 'overdue',
  ADMINISTERED: 'already-given',
  UNRESOLVED: 'unresolved',
};

const HISTORY_REQUEST_CHANGED_PATIENT = 'History request changed patient';

export function isHpvDose(
  vaccineConceptUuid: string | null | undefined,
  ...doseConceptUuids: Array<string | null | undefined>
): boolean {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  if (!vaccine) return false;
  return doseConceptUuids.some((uuid) => !!uuid?.trim() && uuid.trim() === vaccine);
}

export function hpvDoseId(
  vaccineConceptUuid: string | null | undefined,
  hpv1ConceptUuid: string | null | undefined,
  hpv2ConceptUuid: string | null | undefined,
): '' | HpvDoseId {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  const hpv1 = hpv1ConceptUuid?.trim() ?? '';
  const hpv2 = hpv2ConceptUuid?.trim() ?? '';
  if (!vaccine || (hpv1 && hpv2 && hpv1 === hpv2)) return '';
  if (hpv1 && vaccine === hpv1) return 'HPV1';
  if (hpv2 && vaccine === hpv2) return 'HPV2';
  return '';
}

/**
 * OpenMRS patient.gender is compared the same way as the partograph:
 * lower-case the value, then accept "female" or "f". Anything else,
 * including a missing value, is not female.
 */
export function isHpvFemale(gender: unknown): boolean {
  if (typeof gender !== 'string') return false;
  const normalized = gender.toLowerCase();
  return normalized === 'female' || normalized === 'f';
}

export function hpvStatusLabel(code: string | null | undefined): string {
  switch (code) {
    case 'due': return 'Due';
    case 'overdue': return 'Overdue';
    case 'not-female': return 'Not eligible by sex';
    case 'not-yet-due': return 'Too young';
    case 'not-eligible': return 'Too old';
    case 'waiting-for-prerequisite': return 'HPV2 requires HPV1';
    case 'waiting-for-interval': return 'HPV2 not yet due';
    case 'already-given': return 'Already given';
    case 'unresolved': return 'History could not be resolved';
    case 'allowed': return '';
    default: return code ? 'History could not be resolved' : 'Checking immunization history…';
  }
}

function gateCode(status: SequenceStatus): HpvGateCode {
  return STATUS_CODE[status] ?? 'unresolved';
}

function configuredDose(config: SequenceIdentityConfig, doseId: HpvDoseId, supplied: string): boolean {
  return (config.vaccineConceptUuids?.[doseId]?.trim() ?? '') === supplied.trim() && supplied.trim() !== '';
}

type HistoryPage = {
  resourceType?: string;
  type?: string;
  total?: number;
  entry?: Array<{ resource: FhirImmunization }>;
  link?: Array<{ relation: string; url: string }>;
  results?: NationalEncounter[];
  links?: Array<{ rel: string; uri: string }>;
};

/**
 * History did not load. HPV1 age can still be refused from the birth date.
 * An age-eligible HPV1 is not treated as due: that would skip the duplicate
 * check. HPV2 is not handled here, because a missing chart is not proof
 * that HPV1 is absent.
 */
function hpv1WhenHistoryUnavailable(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  config: SequenceIdentityConfig,
): HpvGateCode {
  const ageOnly = evaluateSequence({
    patientUuid,
    doseId: 'HPV1',
    birthDate,
    evaluationDate,
    fhir: [],
    encounters: [],
    config,
  });
  if (ageOnly.status === 'NOT_YET_DUE' || ageOnly.status === 'NOT_ELIGIBLE') return gateCode(ageOnly.status);
  return 'unresolved';
}

export async function evaluateHpvAdministration(input: {
  patientUuid: string;
  gender: unknown;
  birthDate: string;
  evaluationDate: string;
  vaccineConceptUuid: string;
  hpv1ConceptUuid: string;
  hpv2ConceptUuid: string;
  editingEncounterUuid?: string;
  config: SequenceIdentityConfig;
  fhirBaseUrl: string;
  restBaseUrl: string;
  fetchPage: (url: string) => Promise<HistoryPage>;
}): Promise<HpvGateCode> {
  const hpv1 = input.hpv1ConceptUuid?.trim() ?? '';
  const hpv2 = input.hpv2ConceptUuid?.trim() ?? '';
  const vaccine = input.vaccineConceptUuid?.trim() ?? '';
  if (hpv1 && hpv2 && hpv1 === hpv2 && vaccine === hpv1) return 'unresolved';
  const doseId = hpvDoseId(vaccine, hpv1, hpv2);
  if (!doseId) return 'allowed';
  if (!configuredDose(input.config, doseId, doseId === 'HPV1' ? hpv1 : hpv2)) return 'unresolved';
  if (!isHpvFemale(input.gender)) return 'not-female';
  const patientUuid = input.patientUuid?.trim() ?? '';
  if (!patientUuid) return 'unresolved';
  let birthDate: string;
  let evaluationDate: string;
  let urls: ReturnType<typeof sequenceHistoryUrls>;
  try {
    birthDate = clinicalDate(input.birthDate);
    evaluationDate = clinicalDate(input.evaluationDate);
    urls = sequenceHistoryUrls(patientUuid, input.fhirBaseUrl, input.restBaseUrl);
  } catch {
    return 'unresolved';
  }
  try {
    const loaded = await loadHistory(urls.fhirUrl, urls.encounterUrl, async (url) => {
      const requested = new URL(url, 'http://openmrs.local').searchParams.get('patient');
      if (requested && requested !== patientUuid) throw new Error(HISTORY_REQUEST_CHANGED_PATIENT);
      return input.fetchPage(url);
    });
    if (!historyBelongsToPatient(patientUuid, loaded.fhir, loaded.encounters)) return 'unresolved';
    const editing = input.editingEncounterUuid?.trim() ?? '';
    if (editing && loaded.encounters.some((encounter) => encounter?.uuid === editing && encounter.patient?.uuid !== patientUuid)) {
      return 'unresolved';
    }
    const encounters = encountersOmittingEditingVaccine(
      loaded.encounters,
      editing,
      input.config.vaccineQuestionUuid,
      vaccine,
    );
    const result = evaluateSequence({
      patientUuid,
      doseId,
      birthDate,
      evaluationDate,
      fhir: loaded.fhir,
      encounters,
      config: input.config,
    });
    return gateCode(result.status);
  } catch (error) {
    if (error instanceof Error && error.message === HISTORY_REQUEST_CHANGED_PATIENT) return 'unresolved';
    if (doseId !== 'HPV1') return 'unresolved';
    return hpv1WhenHistoryUnavailable(patientUuid, birthDate, evaluationDate, input.config);
  }
}
