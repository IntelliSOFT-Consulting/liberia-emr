/**
 * Td pregnancy eligibility and TT/Td equivalence.
 *
 * The Data Dictionary is authoritative. Td is one tetanus sequence: ANC TT1–TT5
 * and immunization TD–TD5 are the same canonical doses. Pregnancy must be
 * confirmed from the pregnancy-status concept in the current episode. Sex, age,
 * and an ANC visit with no pregnancy-status observation do not establish it.
 *
 * Dose identity, duplicate/conflict detection, and interval evaluation are not
 * reimplemented here: they are read through `evaluateSequence` (sequence.ts),
 * the same reconciled reader used by the routine schedule and Pediatric Pfizer.
 * This module adds only the Td-specific pregnancy gate on top of that shared
 * history. `fhir` history is required here precisely because a Td/TT dose can
 * be recorded as a FHIR Immunization resource as well as a national/ANC
 * encounter, and both must count as the same administration.
 */
import { addDateOffset, type Offset } from './eligibility.ts';
import { CONFLICTING_DATES_ISSUE, encountersOmittingEditingVaccine, type FhirImmunization } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { evaluateSequence, type SequenceResult } from './sequence.ts';
import { previousDeliveryTimeBefore, type EpisodeEncounter, type EpisodeObs, type LabourEpisodeConfig } from '../forms/labour-episode.ts';

export const MONROVIA_TIME_ZONE = 'Africa/Monrovia';

export type TdGateCode =
  | 'allowed'
  | 'unknown-pregnancy'
  | 'history-conflict'
  | 'already-given'
  | 'too-soon'
  | 'unresolved';

export type TdSequence = 1 | 2 | 3 | 4 | 5;

export interface TdDoseConcepts {
  sequence: TdSequence;
  tdConceptUuid: string;
  ttConceptUuid: string;
}

export interface TdConcepts {
  pregnancyStatusConceptUuid: string;
  /** Shipped CIEL 5272 answers: first, second, and third trimester. */
  pregnantValueUuids: readonly string[];
  vaccineNameConceptUuid: string;
  doses: readonly TdDoseConcepts[];
}

/** Also assignable to history.ts's `NationalEncounter`: same shape, read through evaluateSequence. */
export interface TdHistoryEncounter extends EpisodeEncounter {
  voided?: boolean;
  patient?: { uuid?: string };
  obs?: HistoryObs[];
}

export interface HistoryObs extends EpisodeObs {
  voided?: boolean;
  groupMembers?: HistoryObs[];
}

export type PregnancyClassification = 'pregnant' | 'unknown';

const INTERVAL_AFTER_PREVIOUS: Partial<Record<TdSequence, Offset>> = {
  2: { value: 4, unit: 'weeks' },
  3: { value: 6, unit: 'months' },
  4: { value: 1, unit: 'years' },
  5: { value: 1, unit: 'years' },
};

const UUID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+A+)$/i;

export function isTdVaccine(vaccineConceptUuid: string | null | undefined, ...doseConceptUuids: Array<string | null | undefined>): boolean {
  const vaccine = vaccineConceptUuid?.trim() ?? '';
  if (!vaccine) {
    return false;
  }
  return doseConceptUuids.some((uuid) => !!uuid?.trim() && uuid.trim() === vaccine);
}

export function tdConceptsFromFormArgs(
  pregnancyStatusConceptUuid: string,
  firstTrimesterUuid: string,
  secondTrimesterUuid: string,
  thirdTrimesterUuid: string,
  vaccineNameConceptUuid: string,
  td1: string,
  tt1: string,
  td2: string,
  tt2: string,
  td3: string,
  tt3: string,
  td4: string,
  tt4: string,
  td5: string,
  tt5: string,
): TdConcepts {
  const doses: TdDoseConcepts[] = [
    { sequence: 1, tdConceptUuid: td1, ttConceptUuid: tt1 },
    { sequence: 2, tdConceptUuid: td2, ttConceptUuid: tt2 },
    { sequence: 3, tdConceptUuid: td3, ttConceptUuid: tt3 },
    { sequence: 4, tdConceptUuid: td4, ttConceptUuid: tt4 },
    { sequence: 5, tdConceptUuid: td5, ttConceptUuid: tt5 },
  ];
  return {
    pregnancyStatusConceptUuid,
    pregnantValueUuids: [firstTrimesterUuid, secondTrimesterUuid, thirdTrimesterUuid],
    vaccineNameConceptUuid,
    doses,
  };
}

/** Date-only values stay on that calendar day. Timestamps use the Monrovia calendar date. */
export function monroviaCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return calendarDate(trimmed);
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: MONROVIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
  return calendarDate(formatted);
}

/** Inclusive end of a Monrovia calendar day, so a date-only encounter includes that day's observations. */
export function endOfMonroviaDay(dateOnly: string): number | null {
  if (!calendarDate(dateOnly)) {
    return null;
  }
  let utc = Date.parse(`${dateOnly}T23:59:59.999Z`);
  for (let step = 0; step < 30; step++) {
    if (monroviaCalendarDate(new Date(utc).toISOString()) === dateOnly) {
      return utc;
    }
    utc -= 60 * 60 * 1000;
  }
  return null;
}

function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value;
}

function conceptValueUuid(value: EpisodeObs['value']): string | null {
  if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) {
    return value.trim();
  }
  if (value && typeof value === 'object' && typeof value.uuid === 'string' && value.uuid.trim()) {
    return value.uuid.trim();
  }
  return null;
}

function walkObs(obs: HistoryObs[] | undefined, visit: (item: HistoryObs) => void) {
  for (const item of obs ?? []) {
    visit(item);
    if (item.groupMembers?.length) {
      walkObs(item.groupMembers, visit);
    }
  }
}

function conceptsReady(concepts: TdConcepts): boolean {
  if (!concepts.pregnancyStatusConceptUuid.trim() || !concepts.vaccineNameConceptUuid.trim()) {
    return false;
  }
  if (concepts.doses.length !== 5) {
    return false;
  }
  return concepts.doses.every((dose, index) => dose.sequence === index + 1 && dose.tdConceptUuid.trim() && dose.ttConceptUuid.trim());
}

export function classifyCurrentPregnancy(input: {
  encounters: readonly TdHistoryEncounter[];
  config: LabourEpisodeConfig;
  evaluationTime: number;
  concepts: TdConcepts;
}): PregnancyClassification {
  const pregnant = new Set(input.concepts.pregnantValueUuids.map((uuid) => uuid.trim()).filter(Boolean));
  const episodeStart = previousDeliveryTimeBefore([...input.encounters], input.config, input.evaluationTime);
  const hits: Array<{ time: number; kind: PregnancyClassification }> = [];

  for (const encounter of input.encounters) {
    if (encounter.voided) {
      continue;
    }
    const time = new Date(encounter.encounterDatetime).getTime();
    if (!Number.isFinite(time) || time <= episodeStart || time > input.evaluationTime) {
      continue;
    }
    walkObs(encounter.obs as HistoryObs[] | undefined, (obs) => {
      if (obs.voided || obs.concept?.uuid !== input.concepts.pregnancyStatusConceptUuid) {
        return;
      }
      const value = conceptValueUuid(obs.value);
      hits.push({ time, kind: value && pregnant.has(value) ? 'pregnant' : 'unknown' });
    });
  }

  if (!hits.length) {
    return 'unknown';
  }
  const latest = Math.max(...hits.map((hit) => hit.time));
  const kinds = new Set(hits.filter((hit) => hit.time === latest).map((hit) => hit.kind));
  if (kinds.size !== 1) {
    return 'unknown';
  }
  return [...kinds][0];
}

function doseIdForSequence(sequence: TdSequence): string {
  return `TD${sequence}`;
}

function sequenceStatusToGateCode(result: SequenceResult): TdGateCode {
  switch (result.status) {
    case 'ADMINISTERED':
      return 'already-given';
    case 'DUE':
    case 'OVERDUE':
      return 'allowed';
    case 'UNRESOLVED':
      return result.issues.includes(CONFLICTING_DATES_ISSUE) ? 'history-conflict' : 'unresolved';
    default:
      // NOT_YET_DUE, WAITING_FOR_PREREQUISITE, WAITING_FOR_INTERVAL, NOT_ELIGIBLE: the
      // Td sequence rules have no upper age, so only the interval/prerequisite cases
      // are reachable here in practice, both reported as the dictionary's single
      // "not yet" outcome for this gate.
      return 'too-soon';
  }
}

/**
 * Td save decision for the national Immunization form. Dose identity and
 * duplicate/conflict/interval evaluation are read through `evaluateSequence`,
 * using the patient's full FHIR Immunization history plus national/ANC
 * encounters, so a Td dose recorded either as a FHIR Immunization resource or
 * as an ANC TT date counts as the same administration exactly once. Pregnancy
 * stays a Td-specific gate on top of that shared history.
 */
export function decideTdGate(input: {
  patientId?: string;
  birthDate?: string;
  evaluationDate?: string;
  vaccineConceptUuid?: string;
  editingEncounterUuid?: string;
  concepts: TdConcepts;
  fhir?: readonly FhirImmunization[];
  encounters: readonly TdHistoryEncounter[];
  episodeConfig: LabourEpisodeConfig;
  config: SequenceIdentityConfig;
  historyComplete: boolean;
}): TdGateCode {
  const doseUuids = input.concepts.doses.map((dose) => dose.tdConceptUuid);
  if (!isTdVaccine(input.vaccineConceptUuid, ...doseUuids)) {
    return 'allowed';
  }
  const patientId = input.patientId?.trim() ?? '';
  if (!input.historyComplete || !patientId || !conceptsReady(input.concepts)) {
    return 'unresolved';
  }
  const birthDate = monroviaCalendarDate(input.birthDate);
  const evaluationDate = monroviaCalendarDate(input.evaluationDate);
  const evaluationTime = evaluationDate ? endOfMonroviaDay(evaluationDate) : null;
  if (!birthDate || !evaluationDate || evaluationTime === null) {
    return 'unresolved';
  }

  const pregnancy = classifyCurrentPregnancy({
    encounters: input.encounters,
    config: input.episodeConfig,
    evaluationTime,
    concepts: input.concepts,
  });
  if (pregnancy !== 'pregnant') {
    return 'unknown-pregnancy';
  }

  const sequence = input.concepts.doses.find((dose) => dose.tdConceptUuid.trim() === input.vaccineConceptUuid?.trim())?.sequence;
  if (!sequence) {
    return 'unresolved';
  }
  const encounters = encountersOmittingEditingVaccine(
    input.encounters,
    input.editingEncounterUuid,
    input.concepts.vaccineNameConceptUuid,
    input.vaccineConceptUuid,
  );
  try {
    const result = evaluateSequence({
      patientUuid: patientId,
      doseId: doseIdForSequence(sequence),
      birthDate,
      evaluationDate,
      fhir: input.fhir ?? [],
      encounters,
      config: input.config,
    });
    return sequenceStatusToGateCode(result);
  } catch {
    return 'unresolved';
  }
}

/** The next dose's interval date, for tests that need to show the DD interval was applied. */
export function tdIntervalDate(previousDate: string, sequence: TdSequence): string {
  const interval = INTERVAL_AFTER_PREVIOUS[sequence];
  if (!interval) {
    throw new Error('Td dose 1 has no predecessor interval');
  }
  return addDateOffset(previousDate, interval);
}
