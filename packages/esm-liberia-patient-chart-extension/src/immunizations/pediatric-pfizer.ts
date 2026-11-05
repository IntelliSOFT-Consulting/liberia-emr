import { clinicalDate } from './clinical-date.ts';
import { encountersOmittingEditingVaccine, type FhirImmunization, type NationalEncounter } from './history.ts';
import { loadHistory, sequenceHistoryUrls } from './load-history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { evaluateSequence, type SequenceStatus } from './sequence.ts';

/**
 * Pediatric Pfizer save decision for the national Immunization form.
 * Dose identity comes from the form's ${var.*} arguments and must match
 * runtime routineImmunizations config. History is read through the shared
 * sequence helper. This module does not write encounters.
 */
export type PediatricPfizerGateCode =
  | 'allowed'
  | 'not-yet-due'
  | 'not-eligible'
  | 'waiting-for-prerequisite'
  | 'waiting-for-interval'
  | 'due'
  | 'overdue'
  | 'already-given'
  | 'history-unavailable-dose1'
  | 'unresolved';

export type PediatricPfizerDoseId = 'PediatricPfizer1' | 'PediatricPfizer2';

const STATUS_CODE: Record<SequenceStatus, PediatricPfizerGateCode> = {
  NOT_YET_DUE: 'not-yet-due',
  NOT_ELIGIBLE: 'not-eligible',
  WAITING_FOR_PREREQUISITE: 'waiting-for-prerequisite',
  WAITING_FOR_INTERVAL: 'waiting-for-interval',
  DUE: 'due',
  OVERDUE: 'overdue',
  ADMINISTERED: 'already-given',
  UNRESOLVED: 'unresolved',
};

export function isPediatricPfizerDose(
  vaccineConceptUuid: string | null | undefined,
  ...doseConceptUuids: Array<string | null | undefined>
): boolean {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  if (!vaccine) return false;
  return doseConceptUuids.some((uuid) => !!uuid?.trim() && uuid.trim() === vaccine);
}

export function pediatricPfizerDoseId(
  vaccineConceptUuid: string | null | undefined,
  dose1ConceptUuid: string | null | undefined,
  dose2ConceptUuid: string | null | undefined,
): '' | PediatricPfizerDoseId {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  const dose1 = dose1ConceptUuid?.trim() ?? '';
  const dose2 = dose2ConceptUuid?.trim() ?? '';
  if (!vaccine || (dose1 && dose2 && dose1 === dose2)) return '';
  if (dose1 && vaccine === dose1) return 'PediatricPfizer1';
  if (dose2 && vaccine === dose2) return 'PediatricPfizer2';
  return '';
}

export function pediatricPfizerStatusLabel(code: string | null | undefined): string {
  switch (code) {
    case 'due': return 'Due';
    case 'overdue': return 'Overdue';
    case 'waiting-for-prerequisite': return 'Waiting for dose 1';
    case 'waiting-for-interval': return 'Waiting until 28 days after dose 1';
    case 'already-given': return 'Already recorded';
    case 'not-yet-due': return 'Not yet due';
    case 'not-eligible': return 'Not eligible';
    case 'history-unavailable-dose1':
      return 'Immunization history could not be checked. Verify prior vaccination history before administration.';
    case 'unresolved': return 'History could not be checked';
    case 'allowed': return '';
    default: return code ? 'History could not be checked' : 'Checking immunization history…';
  }
}

export function historyBelongsToPatient(
  patientUuid: string,
  fhir: readonly FhirImmunization[],
  encounters: readonly NationalEncounter[],
): boolean {
  const patient = patientUuid.trim();
  if (!patient) return false;
  const reference = `Patient/${patient}`;
  return fhir.every((record) => record?.patient?.reference === reference)
    && encounters.every((encounter) => encounter?.patient?.uuid === patient);
}

const HISTORY_REQUEST_CHANGED_PATIENT = 'History request changed patient';

function gateCode(status: SequenceStatus): PediatricPfizerGateCode {
  return STATUS_CODE[status] ?? 'unresolved';
}

/**
 * History did not load. Age can still be decided for dose 1, because that rule
 * has no predecessor. An empty chart is not passed through as Due: that would
 * claim there is no earlier dose. Dose 2 is not handled here.
 */
function dose1WhenHistoryUnavailable(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  config: SequenceIdentityConfig,
): PediatricPfizerGateCode {
  const ageOnly = evaluateSequence({
    patientUuid,
    doseId: 'PediatricPfizer1',
    birthDate,
    evaluationDate,
    fhir: [],
    encounters: [],
    config,
  });
  if (ageOnly.status === 'DUE' || ageOnly.status === 'OVERDUE') return 'history-unavailable-dose1';
  if (ageOnly.status === 'NOT_YET_DUE' || ageOnly.status === 'NOT_ELIGIBLE') return gateCode(ageOnly.status);
  return 'unresolved';
}

function configuredDose(config: SequenceIdentityConfig, doseId: PediatricPfizerDoseId, supplied: string): boolean {
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
 * The hidden encounter date is a form-engine Date instant, not a date string.
 * Read that instant on the Monrovia calendar. A missing or unreadable value
 * still fails closed. This does not accept a history timestamp.
 */
function formClinicalDate(value: unknown): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Invalid timestamp');
    return clinicalDate(value.toISOString());
  }
  if (typeof value !== 'string') throw new Error('Missing clinical date');
  return clinicalDate(value);
}

export async function evaluatePediatricPfizerAdministration(input: {
  patientUuid: string;
  birthDate: string | Date;
  evaluationDate: string | Date;
  vaccineConceptUuid: string;
  dose1ConceptUuid: string;
  dose2ConceptUuid: string;
  editingEncounterUuid?: string;
  config: SequenceIdentityConfig;
  fhirBaseUrl: string;
  restBaseUrl: string;
  fetchPage: (url: string) => Promise<HistoryPage>;
}): Promise<PediatricPfizerGateCode> {
  const dose1 = input.dose1ConceptUuid?.trim() ?? '';
  const dose2 = input.dose2ConceptUuid?.trim() ?? '';
  const vaccine = input.vaccineConceptUuid?.trim() ?? '';
  if (dose1 && dose2 && dose1 === dose2 && vaccine === dose1) return 'unresolved';
  const doseId = pediatricPfizerDoseId(vaccine, dose1, dose2);
  if (!doseId) return 'allowed';
  if (!configuredDose(input.config, doseId, doseId === 'PediatricPfizer1' ? dose1 : dose2)) return 'unresolved';
  const patientUuid = input.patientUuid?.trim() ?? '';
  if (!patientUuid) return 'unresolved';
  let birthDate: string;
  let evaluationDate: string;
  let urls: ReturnType<typeof sequenceHistoryUrls>;
  try {
    birthDate = formClinicalDate(input.birthDate);
    evaluationDate = formClinicalDate(input.evaluationDate);
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
    if (doseId !== 'PediatricPfizer1') return 'unresolved';
    return dose1WhenHistoryUnavailable(patientUuid, birthDate, evaluationDate, input.config);
  }
}
