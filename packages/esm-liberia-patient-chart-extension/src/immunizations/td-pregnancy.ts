/**
 * Td pregnancy eligibility and TT/Td equivalence.
 *
 * The Data Dictionary is authoritative. Td is one tetanus sequence: ANC TT1–TT5
 * and immunization TD–TD5 are the same canonical doses. Pregnancy must be
 * confirmed from the pregnancy-status concept in the current episode. Sex, age,
 * and an ANC visit with no pregnancy-status observation do not establish it.
 */
import { addDateOffset, evaluateEligibility, type AdministeredDose, type EligibilityRule, type Offset } from './eligibility.ts';
import { previousDeliveryTimeBefore, type EpisodeEncounter, type EpisodeObs, type LabourEpisodeConfig } from '../forms/labour-episode.ts';

export const TD_HISTORY_PAGE_LIMIT = 100;
/** Stop following `next` if a response keeps advertising another page. The chart is then incomplete and Td stays blocked. */
export const TD_HISTORY_MAX_PAGES = 20;
export const IMMUNIZATION_FORM_NAME = 'Immunization';
export const MONROVIA_TIME_ZONE = 'Africa/Monrovia';

const ENCOUNTER_REP =
  'custom:(uuid,encounterDatetime,encounterType:(uuid,display),form:(uuid,name,display),obs:(uuid,concept:(uuid,display),value))';

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

export interface TdHistoryEncounter extends EpisodeEncounter {
  voided?: boolean;
}

interface HistoryObs extends EpisodeObs {
  voided?: boolean;
  groupMembers?: HistoryObs[];
}

export type PregnancyClassification = 'pregnant' | 'unknown';

/** OpenMRS REST list page. `totalCount` is set when the request asked for it. */
export interface RestListPage<T> {
  results?: T[];
  totalCount?: number;
  links?: ReadonlyArray<{ rel?: string; uri?: string }>;
}

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

export function isImmunizationFormEncounter(encounter: EpisodeEncounter): boolean {
  const label = (encounter.form?.name || encounter.form?.display || '').trim();
  return label === IMMUNIZATION_FORM_NAME || label.startsWith(`${IMMUNIZATION_FORM_NAME} `);
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

/** Another page exists when the list links `next`, or when a requested `totalCount` is still larger than the rows loaded. */
export function restPageHasNext(page: RestListPage<unknown>): boolean {
  return (page.links ?? []).some((link) => link.rel === 'next');
}

export function immunizationEncounterPagePath(patientId: string, startIndex: number, includeTotalCount: boolean): string {
  const params = new URLSearchParams({
    patient: patientId,
    v: ENCOUNTER_REP,
    limit: String(TD_HISTORY_PAGE_LIMIT),
    startIndex: String(startIndex),
  });
  if (includeTotalCount) {
    params.set('totalCount', 'true');
  }
  return `encounter?${params.toString()}`;
}

function reportedTotal(page: RestListPage<unknown>): number | null {
  return typeof page.totalCount === 'number' && Number.isFinite(page.totalCount) ? page.totalCount : null;
}

/**
 * Read encounter pages until the REST contract says the list is finished.
 * Page length is not a completeness signal: a full page with no `next` link and no remaining `totalCount` is complete.
 * A further page that cannot be read, or a `next` link that never ends, leaves the history incomplete.
 */
export async function collectEncounterPages<T>(
  fetchPage: (startIndex: number, includeTotalCount: boolean) => Promise<RestListPage<T>>,
  maxPages = TD_HISTORY_MAX_PAGES,
): Promise<{ encounters: T[]; complete: boolean }> {
  const encounters: T[] = [];
  let startIndex = 0;
  let totalCount: number | null = null;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await fetchPage(startIndex, pageNumber === 0);
    if (!Array.isArray(page.results)) {
      throw new Error('Immunization history response was incomplete');
    }
    if (pageNumber === 0) {
      totalCount = reportedTotal(page);
    }
    const loaded = startIndex + page.results.length;
    const moreByCount = totalCount !== null && loaded < totalCount;
    const moreByLink = restPageHasNext(page);
    if (page.results.length === 0 && (moreByLink || moreByCount)) {
      throw new Error('Immunization history page was empty while more results were indicated');
    }
    encounters.push(...page.results);
    if (!moreByCount && !moreByLink) {
      return { encounters, complete: true };
    }
    if (pageNumber + 1 >= maxPages) {
      return { encounters, complete: false };
    }
    startIndex += TD_HISTORY_PAGE_LIMIT;
  }
  return { encounters, complete: false };
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

interface CanonicalDose {
  sequence: TdSequence;
  administeredDate: string;
  ids: string[];
}

type HistoryRead =
  | { ok: true; doses: CanonicalDose[] }
  | { ok: false; code: 'history-conflict' | 'unresolved' };

export function readTdHistory(input: {
  encounters: readonly TdHistoryEncounter[];
  concepts: TdConcepts;
  editingEncounterUuid?: string;
}): HistoryRead {
  const byTd = new Map<string, TdSequence>();
  const byTt = new Map<string, TdSequence>();
  for (const dose of input.concepts.doses) {
    byTd.set(dose.tdConceptUuid.trim(), dose.sequence);
    byTt.set(dose.ttConceptUuid.trim(), dose.sequence);
  }
  const editing = input.editingEncounterUuid?.trim() ?? '';
  const grouped = new Map<TdSequence, DoseHistory>();

  for (const encounter of input.encounters) {
    if (encounter.voided) {
      continue;
    }
    const encounterId = encounter.uuid?.trim() ?? '';
    const skipImmunizationDose = !!editing && encounterId === editing;
    walkObs(encounter.obs as HistoryObs[] | undefined, (obs) => {
      if (obs.voided) {
        return;
      }
      const conceptUuid = obs.concept?.uuid?.trim() ?? '';
      const ttSequence = byTt.get(conceptUuid);
      if (ttSequence) {
        if (obs.value === undefined || obs.value === null || obs.value === '') {
          return;
        }
        const administeredDate = monroviaCalendarDate(obs.value);
        if (!administeredDate) {
          markUnreadable(grouped, ttSequence);
          return;
        }
        addDate(grouped, ttSequence, administeredDate);
        return;
      }
      if (skipImmunizationDose || !isImmunizationFormEncounter(encounter) || conceptUuid !== input.concepts.vaccineNameConceptUuid) {
        return;
      }
      const tdSequence = byTd.get(conceptValueUuid(obs.value) ?? '');
      if (!tdSequence) {
        return;
      }
      const administeredDate = monroviaCalendarDate(encounter.encounterDatetime);
      if (!administeredDate) {
        markUnreadable(grouped, tdSequence);
        return;
      }
      addDate(grouped, tdSequence, administeredDate);
    });
  }

  const entries = [...grouped.entries()];
  if (entries.some(([, history]) => history.unreadable)) {
    return { ok: false, code: 'unresolved' };
  }
  if (entries.some(([, history]) => history.dates.size > 1)) {
    return { ok: false, code: 'history-conflict' };
  }
  const doses: CanonicalDose[] = [];
  for (const [sequence, history] of entries) {
    if (history.dates.size === 1) {
      doses.push({ sequence, administeredDate: [...history.dates][0], ids: [`td-${sequence}`] });
    }
  }
  return { ok: true, doses };
}

interface DoseHistory {
  dates: Set<string>;
  unreadable: boolean;
}

function doseHistory(grouped: Map<TdSequence, DoseHistory>, sequence: TdSequence): DoseHistory {
  const current = grouped.get(sequence) ?? { dates: new Set<string>(), unreadable: false };
  grouped.set(sequence, current);
  return current;
}

function markUnreadable(grouped: Map<TdSequence, DoseHistory>, sequence: TdSequence) {
  doseHistory(grouped, sequence).unreadable = true;
}

function addDate(grouped: Map<TdSequence, DoseHistory>, sequence: TdSequence, administeredDate: string) {
  doseHistory(grouped, sequence).dates.add(administeredDate);
}

function eligibilityRule(concepts: TdConcepts, sequence: TdSequence): EligibilityRule {
  const dose = concepts.doses.find((item) => item.sequence === sequence);
  if (!dose) {
    throw new Error('Unknown Td dose');
  }
  const rule: EligibilityRule = {
    vaccineConceptUuid: dose.tdConceptUuid,
    sequenceNumber: sequence,
    dueAge: { value: 0, unit: 'days' },
    overdueAfterDays: null,
  };
  if (sequence > 1) {
    const prior = concepts.doses.find((item) => item.sequence === (sequence - 1) as TdSequence);
    const minimumInterval = INTERVAL_AFTER_PREVIOUS[sequence];
    if (!prior || !minimumInterval) {
      throw new Error('Unknown Td predecessor');
    }
    rule.prerequisite = {
      dose: { vaccineConceptUuid: prior.tdConceptUuid, sequenceNumber: prior.sequence },
      minimumInterval,
    };
  }
  return rule;
}

function toAdministered(concepts: TdConcepts, doses: readonly CanonicalDose[]): AdministeredDose[] {
  return doses.map((dose) => {
    const conceptsForDose = concepts.doses.find((item) => item.sequence === dose.sequence);
    if (!conceptsForDose) {
      throw new Error('Unknown Td dose');
    }
    return {
      id: dose.ids[0],
      vaccineConceptUuid: conceptsForDose.tdConceptUuid,
      sequenceNumber: dose.sequence,
      administeredDate: dose.administeredDate,
    };
  });
}

export function decideTdGate(input: {
  patientId?: string;
  birthDate?: string;
  evaluationDate?: string;
  vaccineConceptUuid?: string;
  editingEncounterUuid?: string;
  concepts: TdConcepts;
  encounters: readonly TdHistoryEncounter[];
  episodeConfig: LabourEpisodeConfig;
  historyComplete: boolean;
}): TdGateCode {
  const doseUuids = input.concepts.doses.map((dose) => dose.tdConceptUuid);
  if (!isTdVaccine(input.vaccineConceptUuid, ...doseUuids)) {
    return 'allowed';
  }
  if (!input.historyComplete || !input.patientId?.trim() || !conceptsReady(input.concepts)) {
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

  const history = readTdHistory({
    encounters: input.encounters,
    concepts: input.concepts,
    editingEncounterUuid: input.editingEncounterUuid,
  });
  if (history.ok === false) {
    return history.code;
  }

  const sequence = input.concepts.doses.find((dose) => dose.tdConceptUuid.trim() === input.vaccineConceptUuid?.trim())?.sequence;
  if (!sequence) {
    return 'unresolved';
  }
  try {
    const result = evaluateEligibility({
      birthDate,
      evaluationDate,
      rule: eligibilityRule(input.concepts, sequence),
      history: toAdministered(input.concepts, history.doses),
    });
    if (result.canAdminister) {
      return 'allowed';
    }
    if (result.status === 'ADMINISTERED') {
      return 'already-given';
    }
    return 'too-soon';
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
