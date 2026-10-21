import type { AdministeredDose } from './eligibility.ts';
import { clinicalDate } from './clinical-date.ts';
import type { FhirDoseMapping, SequenceIdentityConfig } from './routine-config.ts';
import { routineSchedule } from './routine-schedule.ts';
import {
  doseLookup, recognizedDoseIds, ruleById, sequenceRules,
  type DoseLookup, type SequenceRule,
} from './sequence-rules.ts';

export type { FhirDoseMapping };

/** The exact `consolidateHistory` issue message a save-time gate matches to report a date conflict specifically, rather than a generic unresolved history. */
export const CONFLICTING_DATES_ISSUE = 'Same dose has conflicting administration dates';

/**
 * Two readers share this module and one runtime identity map.
 * normalizeHistory serves the routine schedule: dose-specific concepts keep the
 * schedule's internal sequence, and duplicateRecordIds keeps source provenance.
 * consolidateHistory serves sequencing: clinical sequence numbers, ANC TT, and
 * series-scoped failures. A FHIR coding with a system is not an OpenMRS concept
 * UUID; both readers resolve those through fhirDoseMappings.
 */
export interface FhirImmunization {
  resourceType?: string;
  id?: string;
  status?: string;
  patient?: { reference?: string };
  vaccineCode?: { coding?: Array<{ code?: string; system?: string; display?: string }> };
  protocolApplied?: Array<{ doseNumberPositiveInt?: number; doseNumberString?: string }>;
  occurrenceDateTime?: string;
}

export interface NationalObs {
  uuid?: string;
  voided?: boolean;
  concept?: { uuid?: string };
  value?: unknown;
  groupMembers?: NationalObs[];
}

export interface NationalEncounter {
  uuid?: string;
  voided?: boolean;
  patient?: { uuid?: string };
  form?: { uuid?: string };
  encounterDatetime?: string;
  obs?: NationalObs[];
}

export interface HistoryIssue {
  recordId: string;
  message: string;
  /** Omitted issues block every series. Sequencing that does not depend on them stays available. */
  series?: string;
}

export interface ConsolidatedHistory {
  doses: AdministeredDose[];
  issues: HistoryIssue[];
}

export interface NormalizedDose extends AdministeredDose {
  canonicalDoseId: string;
  records: Array<{ recordId: string; source: 'fhir' | 'national-form' }>;
}

export interface NormalizedHistory {
  doses: NormalizedDose[];
  issues: Array<{ recordId: string; message: string }>;
}

/**
 * O3/FHIR Immunization resources plus eligible national-form and ANC TT history.
 * Return dates and AEFI vaccine mentions are not doses. The same canonical dose
 * on the same clinical date, from either source, counts once.
 */
export function consolidateHistory(input: {
  patientUuid: string;
  fhir: readonly FhirImmunization[] | null | undefined;
  encounters: readonly NationalEncounter[] | null | undefined;
  config: SequenceIdentityConfig;
  editingRecordId?: string;
}): ConsolidatedHistory {
  const issues: HistoryIssue[] = [];
  if (!Array.isArray(input.fhir) || !Array.isArray(input.encounters) || !input.patientUuid) {
    return { doses: [], issues: [{ recordId: 'history', message: 'Both complete history sources are required' }] };
  }
  const lookup = doseLookup(input.config);
  if (lookup.ambiguous) {
    return { doses: [], issues: [{ recordId: 'history', message: 'Vaccine concept configuration is ambiguous' }] };
  }
  const nationalForms = new Set((input.config.nationalFormUuids ?? []).map((uuid) => uuid.trim()).filter(Boolean));
  const ancForms = new Set((input.config.ancFormUuids ?? []).map((uuid) => uuid.trim()).filter(Boolean));
  const vaccineQuestionUuid = input.config.vaccineQuestionUuid?.trim() ?? '';
  const pending = new Map<string, { dose: SequenceRule; canonical: string; date: string; ids: string[] }>();
  const remember = (recordId: string, dose: SequenceRule, date: string) => {
    if (recordId === input.editingRecordId) return;
    const canonical = input.config.vaccineConceptUuids?.[dose.id]?.trim() ?? '';
    if (!canonical) {
      const error = new Error('Missing vaccine identity') as Error & { series?: string };
      error.series = dose.series;
      throw error;
    }
    const key = `${dose.id}|${date}`;
    const existing = pending.get(key);
    if (existing) {
      if (!existing.ids.includes(recordId)) existing.ids.push(recordId);
      return;
    }
    pending.set(key, { dose, canonical, date, ids: [recordId] });
  };
  const fail = (recordId: string, message: string, series?: string) => {
    issues.push({ recordId, message, ...(series ? { series } : {}) });
  };

  for (const record of input.fhir) {
    const recordId = `fhir:${record?.id ?? 'unknown'}`;
    try {
      if (!record || record.resourceType !== 'Immunization' || !record.id ||
        record.patient?.reference !== `Patient/${input.patientUuid}`) {
        throw new Error('Invalid patient-scoped Immunization');
      }
      if (record.status === 'entered-in-error' || record.status === 'not-done') continue;
      if (record.status !== 'completed') throw new Error('Unknown administration status');
      const protocols = record.protocolApplied ?? [];
      if (protocols.length > 1 || protocols.some((item) => item.doseNumberString !== undefined)) {
        throw new Error('Ambiguous dose sequence');
      }
      const supplied = protocols[0]?.doseNumberPositiveInt;
      if (supplied !== undefined && (!Number.isSafeInteger(supplied) || supplied < 1)) {
        throw new Error('Ambiguous dose sequence');
      }
      const dose = mappedDose(record.vaccineCode?.coding ?? [], supplied, lookup, input.config.fhirDoseMappings);
      if (!dose) continue;
      if (supplied !== undefined && supplied !== dose.sequenceNumber && supplied !== 1) {
        fail(recordId, 'Sequence conflicts with the dose-specific concept', dose.series);
        continue;
      }
      try {
        if (!record.occurrenceDateTime) throw new Error('Missing administration date');
        remember(recordId, dose, clinicalDate(record.occurrenceDateTime));
      } catch (error) {
        fail(recordId, error instanceof Error ? error.message : 'Malformed Immunization', dose.series);
      }
    } catch (error) {
      fail(recordId, error instanceof Error ? error.message : 'Malformed Immunization', issueSeries(error));
    }
  }

  for (const encounter of input.encounters) {
    const encounterId = `national-form:${encounter?.uuid ?? 'unknown'}`;
    try {
      if (!encounter?.uuid || encounter.patient?.uuid !== input.patientUuid) {
        throw new Error('Invalid patient-scoped encounter');
      }
      if (encounter.voided) continue;
      const formUuid = encounter.form?.uuid?.trim();
      const immunizationForm = !!formUuid && nationalForms.has(formUuid);
      const ancForm = !!formUuid && ancForms.has(formUuid);
      if (!immunizationForm && !ancForm) continue;
      if (!Array.isArray(encounter.obs)) throw new Error('Missing encounter observations');
      const visit = (observations: NationalObs[]) => {
        for (const observation of observations) {
          if (observation?.voided) continue;
          if (!observation?.concept?.uuid) throw new Error('Missing observation concept');
          if (observation.groupMembers) visit(observation.groupMembers);
          const conceptUuid = observation.concept.uuid.trim();
          if (immunizationForm && vaccineQuestionUuid && conceptUuid === vaccineQuestionUuid) {
            readVaccineAnswer(encounter, observation, lookup, remember, fail);
          }
          if (ancForm) readTetanusDate(observation, lookup, remember, fail);
        }
      };
      visit(encounter.obs);
    } catch (error) {
      fail(encounterId, error instanceof Error ? error.message : 'Malformed national history');
    }
  }

  const byDose = new Map<string, Array<{ date: string; ids: string[]; canonical: string }>>();
  for (const item of pending.values()) {
    const dates = byDose.get(item.dose.id) ?? [];
    dates.push({ date: item.date, ids: item.ids, canonical: item.canonical });
    byDose.set(item.dose.id, dates);
  }
  const doses: AdministeredDose[] = [];
  for (const [doseId, dates] of byDose) {
    const dose = dates[0] ? pending.get(`${doseId}|${dates[0].date}`)?.dose : undefined;
    if (!dose) continue;
    if (dates.length > 1) {
      fail(dates[0].ids[0], CONFLICTING_DATES_ISSUE, dose.series);
      continue;
    }
    doses.push({
      id: dates[0].ids.slice().sort().join('+'),
      vaccineConceptUuid: dates[0].canonical,
      sequenceNumber: dose.sequenceNumber,
      administeredDate: dates[0].date,
    });
  }
  return { doses, issues };
}

function dosesForConcept(code: string | undefined, vaccineConceptUuids: Readonly<Record<string, string>>) {
  const trimmed = code?.trim();
  if (!trimmed) return [];
  return routineSchedule.filter((dose) => vaccineConceptUuids[dose.id]?.trim() === trimmed);
}

/** Both successfully loaded, complete collections are required. No historical writes. */
export function normalizeHistory(input: {
  patientUuid: string;
  fhir: readonly FhirImmunization[];
  encounters: readonly NationalEncounter[];
  mappings?: readonly FhirDoseMapping[];
  nationalFormUuids: readonly string[];
  vaccineQuestionUuid: string;
  vaccineConceptUuids: Readonly<Record<string, string>>;
  editingRecordId?: string;
}): NormalizedHistory {
  const nationalFormUuids = (input.nationalFormUuids ?? []).map((uuid) => uuid.trim()).filter(Boolean);
  const vaccineQuestionUuid = input.vaccineQuestionUuid?.trim() ?? '';
  const vaccineConceptUuids = input.vaccineConceptUuids ?? {};
  const result: NormalizedHistory = { doses: [], issues: [] };
  const issue = (recordId: string, message: string) => result.issues.push({ recordId, message });
  const seen = new Map<string, string>();
  const add = (recordId: string, source: 'fhir' | 'national-form', canonicalDoseId: string, date: string) => {
    if (recordId === input.editingRecordId) return;
    const dose = routineSchedule.find((item) => item.id === canonicalDoseId);
    if (!dose) throw new Error('Unknown canonical dose');
    const vaccineConceptUuid = vaccineConceptUuids[dose.id]?.trim() ?? '';
    if (!vaccineConceptUuid) throw new Error('Missing vaccine identity');
    const administeredDate = clinicalDate(date);
    const key = `${canonicalDoseId}:${administeredDate}`;
    if (seen.has(recordId)) {
      if (seen.get(recordId) !== key) throw new Error('Conflicting versions of a history record');
      return;
    }
    seen.set(recordId, key);
    const existing = result.doses.find((item) => item.canonicalDoseId === canonicalDoseId && item.administeredDate === administeredDate);
    if (existing) existing.records.push({ recordId, source });
    else result.doses.push({
      id: recordId, canonicalDoseId, administeredDate,
      vaccineConceptUuid, sequenceNumber: dose.sequenceNumber,
      records: [{ recordId, source }],
    });
  };

  if (!Array.isArray(input.fhir) || !Array.isArray(input.encounters)) {
    issue('history', 'Both complete history sources are required');
    return result;
  }
  for (const record of input.fhir) {
    const recordId = `fhir:${record?.id ?? 'unknown'}`;
    try {
      if (!record || record.resourceType !== 'Immunization' || !record.id ||
        record.patient?.reference !== `Patient/${input.patientUuid}`) throw new Error('Invalid patient-scoped Immunization');
      if (record.status === 'entered-in-error' || record.status === 'not-done') continue;
      if (record.status !== 'completed') throw new Error('Unknown administration status');
      const protocols = record.protocolApplied ?? [];
      if (protocols.length > 1 || protocols.some((item) => item.doseNumberString !== undefined ||
        !Number.isSafeInteger(item.doseNumberPositiveInt) || item.doseNumberPositiveInt! < 1)) {
        throw new Error('Ambiguous dose sequence');
      }
      const sequence = protocols[0]?.doseNumberPositiveInt;
      const candidates = new Set<string>();
      for (const coding of record.vaccineCode?.coding ?? []) {
        if (!coding.system) {
          const specificDoses = dosesForConcept(coding.code, vaccineConceptUuids);
          if (specificDoses.length > 1) throw new Error('Vaccine/dose cannot be mapped unambiguously');
          const specific = specificDoses[0];
          if (specific) {
            const clinicalSequence = Number(specific.id.match(/\d+$/)?.[0] ?? 1);
            if (sequence !== undefined && sequence !== clinicalSequence && sequence !== 1) {
              throw new Error('Sequence conflicts with dose-specific concept');
            }
            candidates.add(specific.id);
          }
        }
        for (const mapping of input.mappings ?? []) {
          if (mapping.code === coding.code && mapping.system === (coding.system ?? '') &&
            mapping.sequenceNumber === sequence) candidates.add(mapping.canonicalDoseId);
        }
      }
      if (candidates.size !== 1) throw new Error('Vaccine/dose cannot be mapped unambiguously');
      add(recordId, 'fhir', [...candidates][0], record.occurrenceDateTime!);
    } catch (error) { issue(recordId, (error as Error).message); }
  }
  for (const encounter of input.encounters) {
    const encounterId = `national-form:${encounter?.uuid ?? 'unknown'}`;
    try {
      if (!encounter?.uuid || encounter.patient?.uuid !== input.patientUuid) throw new Error('Invalid patient-scoped encounter');
      if (encounter.voided || !encounter.form?.uuid || !nationalFormUuids.includes(encounter.form.uuid)) continue;
      if (!Array.isArray(encounter.obs)) throw new Error('Missing encounter observations');
      const visit = (obs: NationalObs[]) => {
        for (const observation of obs) {
          if (observation.voided) continue;
          if (!observation.concept?.uuid) throw new Error('Missing observation concept');
          if (vaccineQuestionUuid && observation.concept.uuid === vaccineQuestionUuid) {
            const recordId = `national-form:${observation.uuid}`;
            try {
              if (!observation.uuid) throw new Error('Missing observation ID');
              const value = observation.value as { uuid?: string } | undefined;
              const matches = dosesForConcept(value?.uuid, vaccineConceptUuids);
              if (matches.length !== 1) throw new Error('National vaccine answer cannot be reconciled');
              add(recordId, 'national-form', matches[0].id, encounter.encounterDatetime!);
            } catch (error) { issue(recordId, (error as Error).message); }
          }
          if (observation.groupMembers) visit(observation.groupMembers);
        }
      };
      visit(encounter.obs);
    } catch (error) { issue(encounterId, (error as Error).message); }
  }
  for (const dose of result.doses) {
    if (result.doses.some((other) => other !== dose && other.canonicalDoseId === dose.canonicalDoseId)) {
      issue(dose.id, 'Same dose has conflicting administration dates; reconcile before sequencing');
    }
  }
  return result;
}

/** Awareness only: no existing authoritative cross-source save interceptor exists. */
export function duplicateRecordIds(history: NormalizedHistory, canonicalDoseId: string) {
  return history.doses.filter((dose) => dose.canonicalDoseId === canonicalDoseId).flatMap((dose) => dose.records.map((record) => record.recordId));
}

/** Canonical doses not in the routine-schedule reader, but shown in the history timeline. */
const TIMELINE_ONLY_SERIES = new Set(['tetanus', 'hpv', 'pediatric-pfizer']);

export interface TimelineEntry {
  canonicalDoseId: string;
  sequenceNumber: number;
  administeredDate: string;
  recordIds: string[];
}

export interface AdministeredTimeline {
  entries: TimelineEntry[];
  /** Some record could not be reconciled; the timeline is not known to be complete or duplicate-free. */
  unresolved: boolean;
}

/**
 * The patient's full administered-vaccine timeline for display: the routine
 * schedule's 21 childhood doses (`normalizeHistory`) plus TD/HPV/Pediatric
 * Pfizer (`consolidateHistory`, which also reads ANC TT as the same canonical
 * dose). A Td/TT dose present in both ANC and Immunization history appears
 * once, by canonical dose and administration date, never twice — both readers
 * already coalesce a same-dose/same-date match before this merge sees it.
 *
 * `normalizeHistory` flags a canonical dose with two different administration
 * dates as an issue but, unlike `consolidateHistory`, does not remove the
 * conflicting entries from its own `doses` array. This function does that
 * filtering itself: a routine-schedule dose that occurs more than once in
 * `normalized.doses` is omitted entirely from the returned timeline, not
 * shown under either date, and the conflict still drives `unresolved` (via
 * `normalizeHistory`'s own issue for that record). Do not guess which date is
 * right; surface it as needing reconciliation instead, the same stance
 * `consolidateHistory` already takes for TD/HPV/Pediatric Pfizer.
 *
 * Newest administration first; ties break by dose id for a stable order.
 * Does not page a live server or write history.
 */
export function administeredTimeline(input: {
  patientUuid: string;
  fhir: readonly FhirImmunization[];
  encounters: readonly NationalEncounter[];
  config: SequenceIdentityConfig;
}): AdministeredTimeline {
  const normalized = normalizeHistory({
    patientUuid: input.patientUuid,
    fhir: input.fhir,
    encounters: input.encounters,
    mappings: input.config.fhirDoseMappings,
    nationalFormUuids: input.config.nationalFormUuids,
    vaccineQuestionUuid: input.config.vaccineQuestionUuid,
    vaccineConceptUuids: input.config.vaccineConceptUuids,
  });
  const consolidated = consolidateHistory({
    patientUuid: input.patientUuid,
    fhir: input.fhir,
    encounters: input.encounters,
    config: input.config,
  });

  const normalizedDoseCounts = new Map<string, number>();
  for (const dose of normalized.doses) {
    normalizedDoseCounts.set(dose.canonicalDoseId, (normalizedDoseCounts.get(dose.canonicalDoseId) ?? 0) + 1);
  }
  const entries: TimelineEntry[] = normalized.doses
    .filter((dose) => normalizedDoseCounts.get(dose.canonicalDoseId) === 1)
    .map((dose) => ({
      canonicalDoseId: dose.canonicalDoseId,
      sequenceNumber: dose.sequenceNumber,
      administeredDate: dose.administeredDate,
      recordIds: dose.records.map((record) => record.recordId),
    }));

  const timelineOnlyDoseIdByConcept = new Map<string, string>();
  for (const rule of sequenceRules) {
    if (!TIMELINE_ONLY_SERIES.has(rule.series)) continue;
    const vaccineConceptUuid = input.config.vaccineConceptUuids?.[rule.id]?.trim();
    if (vaccineConceptUuid) timelineOnlyDoseIdByConcept.set(vaccineConceptUuid, rule.id);
  }
  // normalizeHistory conservatively treats any vaccine outside its 21-dose schedule as
  // unresolved "for the schedule" (see routine-childhood-immunization.md). A TD/HPV/Pediatric
  // Pfizer record that consolidateHistory resolves cleanly is exactly that case, not a real
  // problem for this combined timeline, so its per-record issue there is not carried over.
  const resolvedTimelineOnlyRecordIds = new Set<string>();
  for (const dose of consolidated.doses) {
    const canonicalDoseId = timelineOnlyDoseIdByConcept.get(dose.vaccineConceptUuid);
    if (!canonicalDoseId) continue; // either already covered by normalized, or not a timeline-only series
    for (const recordId of dose.id.split('+')) resolvedTimelineOnlyRecordIds.add(recordId);
    entries.push({
      canonicalDoseId,
      sequenceNumber: dose.sequenceNumber,
      administeredDate: dose.administeredDate,
      recordIds: dose.id.split('+'),
    });
  }

  entries.sort((a, b) =>
    b.administeredDate.localeCompare(a.administeredDate) || a.canonicalDoseId.localeCompare(b.canonicalDoseId));

  const unresolved = normalized.issues.some((issue) => !resolvedTimelineOnlyRecordIds.has(issue.recordId)) ||
    consolidated.issues.some((issue) => !issue.series || TIMELINE_ONLY_SERIES.has(issue.series));

  return { entries, unresolved };
}

function mappedDose(
  coding: ReadonlyArray<{ code?: string; system?: string }>,
  supplied: number | undefined,
  lookup: DoseLookup,
  mappings: readonly FhirDoseMapping[] | undefined,
): SequenceRule | undefined {
  const candidates = new Set<SequenceRule>();
  let sawCode = false;
  let unknown = false;
  const configuredNonSequence = new Set<string>(recognizedDoseIds);
  for (const item of coding) {
    const code = item.code?.trim();
    if (!code) continue;
    sawCode = true;
    let explained = false;
    if (!item.system) {
      const dose = lookup.byConcept.get(code);
      if (dose) {
        explained = true;
        candidates.add(dose);
      } else if (lookup.recognized.has(code)) explained = true;
    }
    for (const mapping of mappings ?? []) {
      if (mapping.code !== code || mapping.system !== (item.system ?? '') || mapping.sequenceNumber !== supplied) continue;
      explained = true;
      const mapped = ruleById(mapping.canonicalDoseId);
      if (mapped) candidates.add(mapped);
      else if (!configuredNonSequence.has(mapping.canonicalDoseId)) unknown = true;
    }
    if (!explained) unknown = true;
  }
  if (!sawCode || unknown || candidates.size > 1) throw new Error('Vaccine/dose cannot be mapped unambiguously');
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function issueSeries(error: unknown): string | undefined {
  return (error as { series?: string } | undefined)?.series;
}

function readVaccineAnswer(
  encounter: NationalEncounter,
  observation: NationalObs,
  lookup: DoseLookup,
  remember: (recordId: string, dose: SequenceRule, date: string) => void,
  fail: (recordId: string, message: string, series?: string) => void,
) {
  const recordId = `national-form:${observation.uuid ?? 'unknown'}`;
  try {
    if (!observation.uuid) throw new Error('Missing observation ID');
    const value = observation.value;
    const conceptUuid = typeof value === 'string' ? value.trim() : (value as { uuid?: string } | undefined)?.uuid?.trim();
    if (!conceptUuid) throw new Error('Missing vaccine answer');
    const dose = lookup.byConcept.get(conceptUuid);
    if (!dose) {
      if (lookup.recognized.has(conceptUuid)) return;
      throw new Error('National vaccine answer cannot be reconciled');
    }
    try {
      if (!encounter.encounterDatetime) throw new Error('Missing administration date');
      remember(recordId, dose, clinicalDate(encounter.encounterDatetime));
    } catch (error) {
      fail(recordId, error instanceof Error ? error.message : 'Malformed vaccine answer', dose.series);
    }
  } catch (error) {
    fail(recordId, error instanceof Error ? error.message : 'Malformed vaccine answer', issueSeries(error));
  }
}

function readTetanusDate(
  observation: NationalObs,
  lookup: DoseLookup,
  remember: (recordId: string, dose: SequenceRule, date: string) => void,
  fail: (recordId: string, message: string, series?: string) => void,
) {
  const conceptUuid = observation.concept?.uuid?.trim();
  const dose = conceptUuid ? lookup.byConcept.get(conceptUuid) : undefined;
  if (!dose || dose.series !== 'tetanus') return;
  const recordId = `anc-tt:${observation.uuid ?? 'unknown'}`;
  try {
    if (!observation.uuid) throw new Error('Missing observation ID');
    if (typeof observation.value !== 'string' || !observation.value) throw new Error('Missing TT administration date');
    remember(recordId, dose, clinicalDate(observation.value));
  } catch (error) {
    fail(recordId, error instanceof Error ? error.message : 'Malformed TT history', 'tetanus');
  }
}
