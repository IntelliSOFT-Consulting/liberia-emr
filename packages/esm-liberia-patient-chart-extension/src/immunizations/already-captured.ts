import { clinicalDate } from './clinical-date.ts';
import {
  consolidateHistory,
  encountersOmittingEditingVaccine,
  normalizeHistory,
  type FhirImmunization,
  type NationalEncounter,
  type NationalObs,
} from './history.ts';
import { loadHistory, sequenceHistoryUrls } from './load-history.ts';
import { historyBelongsToPatient } from './pediatric-pfizer.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { routineSchedule } from './routine-schedule.ts';
import { doseLookup, recognizedDoseIds, ruleById, type SequenceRule } from './sequence-rules.ts';

/**
 * Same canonical dose already present in consolidated immunization history.
 *
 * Duplicate means that dose, not the rest of its series: OPV1 already on file
 * blocks another OPV1 and leaves OPV2 alone. Presence comes from the current
 * history readers. `consolidateHistory` answers sequence doses. `normalizeHistory`
 * answers the routine-schedule doses that are not sequence rules. Adult Pfizer,
 * J&J, the COVID booster, and IPV are canonical doses neither reader stores, so
 * this module only sights those.
 *
 * Td, Pediatric Pfizer, and HPV already reject a repeated dose on their own
 * gates. This helper returns `allowed` for them and does not fetch history,
 * so it does not add a second message or turn Pediatric Pfizer dose 1's
 * history-outage warning into a block.
 *
 * Age and the vaccination date are not inputs to this decision. The form still
 * passes them so the helper's argument order matches the other save gates.
 */
export type AlreadyCapturedCode = 'allowed' | 'already-given' | 'unresolved';

export const ALREADY_RECORDED_VACCINE_MESSAGE =
  'This vaccine has already been recorded for this patient.';

export const IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE =
  'Immunization history could not be checked. This vaccine cannot be recorded until the history is available.';

const SPECIALIZED_DUPLICATE_SERIES = new Set(['tetanus', 'pediatric-pfizer', 'hpv']);

const NON_SCHEDULE_RECOGNIZED: ReadonlySet<string> = new Set(
  recognizedDoseIds.filter((id) => !ruleById(id) && !routineSchedule.some((dose) => dose.id === id)),
);

export type CanonicalDoseMatch =
  | { status: 'unknown' }
  | { status: 'ambiguous' }
  | { status: 'dose'; doseId: string };

export function alreadyCapturedDoseMessage(code: AlreadyCapturedCode | null | undefined): string {
  switch (code) {
    case 'already-given':
      return ALREADY_RECORDED_VACCINE_MESSAGE;
    case 'unresolved':
      return IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE;
    default:
      return '';
  }
}

/** Vaccine-name concept to the canonical dose id. ANC TT concepts are not vaccine answers. */
export function canonicalDoseForVaccineConcept(
  vaccineConceptUuid: string | null | undefined,
  config: Pick<SequenceIdentityConfig, 'vaccineConceptUuids' | 'ancTtConceptUuids'>,
): CanonicalDoseMatch {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  if (!vaccine) return { status: 'unknown' };
  const lookup = doseLookup(config);
  const sequenced = lookup.byConcept.get(vaccine);
  if (lookup.ambiguous && (sequenced || lookup.recognized.has(vaccine))) return { status: 'ambiguous' };
  if (sequenced) return { status: 'dose', doseId: sequenced.id };
  if (!lookup.recognized.has(vaccine)) return { status: 'unknown' };
  const ids = Object.entries(config.vaccineConceptUuids ?? {})
    .filter(([, uuid]) => (uuid?.trim() ?? '') === vaccine)
    .map(([id]) => id);
  if (ids.length !== 1) return { status: 'ambiguous' };
  return { status: 'dose', doseId: ids[0] };
}

export function specializedDuplicateGateOwns(
  vaccineConceptUuid: string | null | undefined,
  config: Pick<SequenceIdentityConfig, 'vaccineConceptUuids' | 'ancTtConceptUuids'>,
): boolean {
  const match = canonicalDoseForVaccineConcept(vaccineConceptUuid, config);
  if (match.status !== 'dose') return false;
  const rule = ruleById(match.doseId);
  return !!rule && SPECIALIZED_DUPLICATE_SERIES.has(rule.series);
}

export function evaluateAlreadyCapturedDose(input: {
  patientUuid: string;
  birthDate: string;
  evaluationDate: string;
  vaccineConceptUuid: string;
  fhir: readonly FhirImmunization[] | null | undefined;
  encounters: readonly NationalEncounter[] | null | undefined;
  config: SequenceIdentityConfig;
  editingEncounterUuid?: string;
}): AlreadyCapturedCode {
  const match = canonicalDoseForVaccineConcept(input.vaccineConceptUuid, input.config);
  if (match.status === 'unknown') return 'allowed';
  if (match.status === 'ambiguous') return 'unresolved';
  if (specializedDuplicateGateOwns(input.vaccineConceptUuid, input.config)) return 'allowed';
  const patientUuid = input.patientUuid?.trim() ?? '';
  if (!patientUuid) return 'unresolved';
  const encounters = Array.isArray(input.encounters)
    ? encountersOmittingEditingVaccine(
      input.encounters,
      input.editingEncounterUuid,
      input.config.vaccineQuestionUuid,
      input.vaccineConceptUuid,
    )
    : input.encounters;
  if (!Array.isArray(input.fhir) || !Array.isArray(encounters)) return 'unresolved';
  const scoped = { ...input, patientUuid, encounters };
  const rule = ruleById(match.doseId);
  if (rule) return fromConsolidated(match.doseId, rule, scoped);
  if (routineSchedule.some((dose) => dose.id === match.doseId)) return fromNormalized(match.doseId, scoped);
  if (NON_SCHEDULE_RECOGNIZED.has(match.doseId)) return fromRecognized(match.doseId, scoped);
  return 'unresolved';
}

function fromConsolidated(
  doseId: string,
  rule: SequenceRule,
  input: HistoryInput,
): AlreadyCapturedCode {
  const history = consolidateHistory(input);
  const blocking = history.issues.filter((issue) => !issue.series || issue.series === rule.series);
  if (blocking.length) return 'unresolved';
  const concept = input.config.vaccineConceptUuids?.[doseId]?.trim() ?? '';
  const present = history.doses.some((dose) =>
    dose.vaccineConceptUuid === concept && dose.sequenceNumber === rule.sequenceNumber);
  return present ? 'already-given' : 'allowed';
}

/**
 * BCG, OPV0, MCV, and the other schedule doses that are not sequence rules.
 * An unscoped consolidation failure fails closed. A normalize issue that is
 * another known dose — a sequenced series, or Pfizer/J&J/booster/IPV — does not.
 */
function fromNormalized(doseId: string, input: HistoryInput): AlreadyCapturedCode {
  const consolidated = consolidateHistory(input);
  if (consolidated.issues.some((issue) => !issue.series)) return 'unresolved';
  const normalized = readNormalized(input);
  const dates = new Set(
    normalized.doses.filter((dose) => dose.canonicalDoseId === doseId).map((dose) => dose.administeredDate),
  );
  if (dates.size > 1) return 'unresolved';
  if (dates.size === 1) return 'already-given';
  const explained = nonScheduleSightings(input).flatMap((sighting) => sighting.recordIds);
  if (unexplainedNormalizeIssue(normalized, consolidated, explained)) return 'unresolved';
  return 'allowed';
}

function fromRecognized(doseId: string, input: HistoryInput): AlreadyCapturedCode {
  const consolidated = consolidateHistory(input);
  if (consolidated.issues.some((issue) => !issue.series)) return 'unresolved';
  const seen = nonScheduleSightings(input);
  const sightings = seen.filter((sighting) => sighting.doseId === doseId);
  if (sightings.some((sighting) => sighting.dateError)) return 'unresolved';
  const dates = new Set(sightings.map((sighting) => sighting.date));
  if (dates.size > 1) return 'unresolved';
  if (dates.size === 1) return 'already-given';
  const others = seen.filter((sighting) => sighting.doseId !== doseId).flatMap((sighting) => sighting.recordIds);
  if (unexplainedNormalizeIssue(readNormalized(input), consolidated, others)) return 'unresolved';
  return 'allowed';
}

type HistoryInput = {
  patientUuid: string;
  fhir: readonly FhirImmunization[];
  encounters: readonly NationalEncounter[];
  config: SequenceIdentityConfig;
};

function readNormalized(input: HistoryInput) {
  return normalizeHistory({
    patientUuid: input.patientUuid,
    fhir: input.fhir,
    encounters: input.encounters,
    mappings: input.config.fhirDoseMappings,
    nationalFormUuids: input.config.nationalFormUuids,
    vaccineQuestionUuid: input.config.vaccineQuestionUuid,
    vaccineConceptUuids: input.config.vaccineConceptUuids,
  });
}

function unexplainedNormalizeIssue(
  normalized: ReturnType<typeof normalizeHistory>,
  consolidated: ReturnType<typeof consolidateHistory>,
  extraRecordIds: readonly string[],
): boolean {
  const explained = new Set(extraRecordIds);
  for (const dose of normalized.doses) {
    for (const record of dose.records) explained.add(record.recordId);
  }
  for (const dose of consolidated.doses) {
    for (const recordId of dose.id.split('+')) {
      if (recordId) explained.add(recordId);
    }
  }
  for (const issue of consolidated.issues) {
    if (issue.series) explained.add(issue.recordId);
  }
  return normalized.issues.some((issue) => !explained.has(issue.recordId));
}

interface DoseSighting {
  doseId: string;
  date: string;
  dateError: boolean;
  recordIds: string[];
}

/**
 * Doses `normalizeHistory` reports as unmapped and `consolidateHistory` skips.
 * The same dose on the same clinical date, from FHIR and the national form, is
 * one sighting.
 */
function nonScheduleSightings(input: HistoryInput): DoseSighting[] {
  const pending = new Map<string, DoseSighting>();
  const remember = (doseId: string, recordId: string, date: string | undefined) => {
    const key = `${doseId}|${date ?? ''}`;
    const existing = pending.get(key);
    if (existing) {
      if (!existing.recordIds.includes(recordId)) existing.recordIds.push(recordId);
      if (date === undefined) existing.dateError = true;
      return;
    }
    pending.set(key, {
      doseId,
      date: date ?? '',
      dateError: date === undefined,
      recordIds: [recordId],
    });
  };
  for (const record of input.fhir) {
    const doseId = nonScheduleFhirDose(record, input);
    if (!doseId) continue;
    let date: string | undefined;
    try {
      if (!record.occurrenceDateTime) throw new Error('Missing administration date');
      date = clinicalDate(record.occurrenceDateTime);
    } catch {
      date = undefined;
    }
    remember(doseId, `fhir:${record.id ?? 'unknown'}`, date);
  }
  const forms = new Set((input.config.nationalFormUuids ?? []).map((uuid) => uuid.trim()).filter(Boolean));
  const question = input.config.vaccineQuestionUuid?.trim() ?? '';
  for (const encounter of input.encounters) {
    if (!encounter?.uuid || encounter.voided || encounter.patient?.uuid !== input.patientUuid) continue;
    const formUuid = encounter.form?.uuid?.trim();
    if (!formUuid || !forms.has(formUuid) || !Array.isArray(encounter.obs) || !question) continue;
    let date: string | undefined;
    try {
      if (!encounter.encounterDatetime) throw new Error('Missing administration date');
      date = clinicalDate(encounter.encounterDatetime);
    } catch {
      date = undefined;
    }
    walkVaccineAnswers(encounter.obs, question, (observation) => {
      const doseId = nonScheduleAnswerDose(observation, input.config);
      if (!doseId) return;
      remember(doseId, `national-form:${observation.uuid ?? 'unknown'}`, date);
    });
  }
  return [...pending.values()];
}

function nonScheduleFhirDose(
  record: FhirImmunization,
  input: { patientUuid: string; config: SequenceIdentityConfig },
): string | undefined {
  if (!record || record.resourceType !== 'Immunization' || !record.id) return undefined;
  if (record.patient?.reference !== `Patient/${input.patientUuid}`) return undefined;
  if (record.status === 'entered-in-error' || record.status === 'not-done') return undefined;
  if (record.status !== 'completed') return undefined;
  const protocols = record.protocolApplied ?? [];
  if (protocols.length > 1 || protocols.some((item) => item.doseNumberString !== undefined)) return undefined;
  const supplied = protocols[0]?.doseNumberPositiveInt;
  const ids = new Set<string>();
  for (const coding of record.vaccineCode?.coding ?? []) {
    const code = coding.code?.trim();
    if (!code) continue;
    if (!coding.system) {
      const match = canonicalDoseForVaccineConcept(code, input.config);
      if (match.status === 'dose' && NON_SCHEDULE_RECOGNIZED.has(match.doseId)) ids.add(match.doseId);
    }
    for (const mapping of input.config.fhirDoseMappings ?? []) {
      if (mapping.code !== code || mapping.system !== (coding.system ?? '') || mapping.sequenceNumber !== supplied) continue;
      if (NON_SCHEDULE_RECOGNIZED.has(mapping.canonicalDoseId)) ids.add(mapping.canonicalDoseId);
    }
  }
  if (ids.size !== 1) return undefined;
  return [...ids][0];
}

function nonScheduleAnswerDose(observation: NationalObs, config: SequenceIdentityConfig): string | undefined {
  const value = observation.value;
  const conceptUuid = typeof value === 'string'
    ? value.trim()
    : (value as { uuid?: string } | undefined)?.uuid?.trim();
  const match = canonicalDoseForVaccineConcept(conceptUuid, config);
  if (match.status !== 'dose' || !NON_SCHEDULE_RECOGNIZED.has(match.doseId)) return undefined;
  return match.doseId;
}

function walkVaccineAnswers(
  observations: readonly NationalObs[],
  question: string,
  visit: (observation: NationalObs) => void,
) {
  for (const observation of observations) {
    if (!observation || observation.voided) continue;
    if (observation.groupMembers) walkVaccineAnswers(observation.groupMembers, question, visit);
    if (observation.concept?.uuid?.trim() === question) visit(observation);
  }
}

const HISTORY_REQUEST_CHANGED_PATIENT = 'History request changed patient';

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
 * Loads the same FHIR and national/ANC pages the other save gates load.
 * Td, Pediatric Pfizer, and HPV return `allowed` without a fetch.
 * Any other mapped dose fails closed when the pages cannot be read.
 */
export async function evaluateAlreadyCapturedDoseFromChart(input: {
  patientUuid: string;
  birthDate: string;
  evaluationDate: string;
  vaccineConceptUuid: string;
  editingEncounterUuid?: string;
  config: SequenceIdentityConfig;
  fhirBaseUrl: string;
  restBaseUrl: string;
  fetchPage: (url: string) => Promise<HistoryPage>;
}): Promise<AlreadyCapturedCode> {
  const vaccine = input.vaccineConceptUuid?.trim() ?? '';
  if (!vaccine) return 'allowed';
  if (specializedDuplicateGateOwns(vaccine, input.config)) return 'allowed';
  const match = canonicalDoseForVaccineConcept(vaccine, input.config);
  if (match.status === 'unknown') return 'allowed';
  if (match.status === 'ambiguous') return 'unresolved';
  const patientUuid = input.patientUuid?.trim() ?? '';
  if (!patientUuid) return 'unresolved';
  try {
    const urls = sequenceHistoryUrls(patientUuid, input.fhirBaseUrl, input.restBaseUrl);
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
    return evaluateAlreadyCapturedDose({
      patientUuid,
      birthDate: input.birthDate,
      evaluationDate: input.evaluationDate,
      vaccineConceptUuid: vaccine,
      fhir: loaded.fhir,
      encounters: loaded.encounters,
      config: input.config,
      editingEncounterUuid: editing,
    });
  } catch {
    return 'unresolved';
  }
}
