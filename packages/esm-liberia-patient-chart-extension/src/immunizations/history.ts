import type { AdministeredDose } from './eligibility.ts';
import { clinicalDate } from './clinical-date.ts';
import {
  ancFormUuid, ignoredConceptUuids, immunizationFormUuid, ruleForConcept, vaccineQuestionUuid, type SequenceRule,
} from './sequence-rules.ts';

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

/**
 * O3/FHIR Immunization resources plus eligible national-form history.
 * Eligible national history is the immunization form's vaccine-name answer and
 * ANC Date-of-TT1..TT5 values. Return dates and AEFI vaccine mentions are not doses.
 * The same canonical dose on the same clinical date, from either source, counts once.
 */
export function consolidateHistory(input: {
  patientUuid: string;
  fhir: readonly FhirImmunization[] | null | undefined;
  encounters: readonly NationalEncounter[] | null | undefined;
  editingRecordId?: string;
}): ConsolidatedHistory {
  const issues: HistoryIssue[] = [];
  if (!Array.isArray(input.fhir) || !Array.isArray(input.encounters) || !input.patientUuid) {
    return { doses: [], issues: [{ recordId: 'history', message: 'Both complete history sources are required' }] };
  }
  const pending = new Map<string, { dose: SequenceRule; date: string; ids: string[] }>();
  const remember = (recordId: string, dose: SequenceRule, date: string) => {
    if (recordId === input.editingRecordId) return;
    const key = `${dose.id}|${date}`;
    const existing = pending.get(key);
    if (existing) {
      if (!existing.ids.includes(recordId)) existing.ids.push(recordId);
      return;
    }
    pending.set(key, { dose, date, ids: [recordId] });
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
      const dose = mappedDose(record.vaccineCode?.coding ?? []);
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
      if (encounter.form?.uuid !== immunizationFormUuid && encounter.form?.uuid !== ancFormUuid) continue;
      if (!Array.isArray(encounter.obs)) throw new Error('Missing encounter observations');
      const visit = (observations: NationalObs[]) => {
        for (const observation of observations) {
          if (observation?.voided) continue;
          if (!observation?.concept?.uuid) throw new Error('Missing observation concept');
          if (observation.groupMembers) visit(observation.groupMembers);
          if (encounter.form?.uuid === immunizationFormUuid && observation.concept.uuid === vaccineQuestionUuid) {
            readVaccineAnswer(encounter, observation, remember, fail);
          }
          if (encounter.form?.uuid === ancFormUuid) readTetanusDate(observation, remember, fail);
        }
      };
      visit(encounter.obs);
    } catch (error) {
      fail(encounterId, error instanceof Error ? error.message : 'Malformed national history');
    }
  }

  const byDose = new Map<string, Array<{ date: string; ids: string[] }>>();
  for (const item of pending.values()) {
    const dates = byDose.get(item.dose.id) ?? [];
    dates.push({ date: item.date, ids: item.ids });
    byDose.set(item.dose.id, dates);
  }
  const doses: AdministeredDose[] = [];
  for (const [doseId, dates] of byDose) {
    const dose = dates[0] ? pending.get(`${doseId}|${dates[0].date}`)?.dose : undefined;
    if (!dose) continue;
    if (dates.length > 1) {
      fail(dates[0].ids[0], 'Same dose has conflicting administration dates', dose.series);
      continue;
    }
    doses.push({
      id: dates[0].ids.slice().sort().join('+'),
      vaccineConceptUuid: dose.vaccineConceptUuid,
      sequenceNumber: dose.sequenceNumber,
      administeredDate: dates[0].date,
    });
  }
  return { doses, issues };
}

function mappedDose(coding: ReadonlyArray<{ code?: string }>): SequenceRule | undefined {
  const candidates = new Set<SequenceRule>();
  let sawCode = false;
  let unknown = false;
  for (const item of coding) {
    if (!item.code) continue;
    sawCode = true;
    const dose = ruleForConcept(item.code);
    if (dose) candidates.add(dose);
    else if (!ignoredConceptUuids.has(item.code)) unknown = true;
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
  remember: (recordId: string, dose: SequenceRule, date: string) => void,
  fail: (recordId: string, message: string, series?: string) => void,
) {
  const recordId = `national-form:${observation.uuid ?? 'unknown'}`;
  try {
    if (!observation.uuid) throw new Error('Missing observation ID');
    const value = observation.value;
    const conceptUuid = typeof value === 'string' ? value : (value as { uuid?: string } | undefined)?.uuid;
    if (!conceptUuid) throw new Error('Missing vaccine answer');
    const dose = ruleForConcept(conceptUuid);
    if (!dose) {
      if (ignoredConceptUuids.has(conceptUuid)) return;
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
  remember: (recordId: string, dose: SequenceRule, date: string) => void,
  fail: (recordId: string, message: string, series?: string) => void,
) {
  const dose = observation.concept?.uuid ? ruleForConcept(observation.concept.uuid) : undefined;
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
