import type { AdministeredDose } from './eligibility';
import { clinicalDate } from './clinical-date.ts';
import { routineSchedule } from './routine-schedule.ts';

export interface FhirDoseMapping {
  code: string;
  system: string;
  sequenceNumber: number;
  canonicalDoseId: string;
}
export interface FhirImmunization {
  resourceType: string;
  id?: string;
  status?: string;
  patient?: { reference?: string };
  vaccineCode?: { coding?: Array<{ code?: string; system?: string }> };
  protocolApplied?: Array<{ doseNumberPositiveInt?: number; doseNumberString?: string }>;
  occurrenceDateTime?: string;
}
export interface NationalObs {
  uuid: string;
  voided?: boolean;
  concept: { uuid: string };
  value?: unknown;
  groupMembers?: NationalObs[];
}
export interface NationalEncounter {
  uuid: string;
  voided?: boolean;
  patient: { uuid: string };
  form?: { uuid: string };
  encounterDatetime: string;
  obs: NationalObs[];
}
export interface NormalizedDose extends AdministeredDose {
  canonicalDoseId: string;
  records: Array<{ recordId: string; source: 'fhir' | 'national-form' }>;
}
export interface NormalizedHistory {
  doses: NormalizedDose[];
  issues: Array<{ recordId: string; message: string }>;
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
    const dose = routineSchedule.find((d) => d.id === canonicalDoseId);
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
    // Identical dose/day from parallel sources describes one clinical dose, retaining provenance.
    const existing = result.doses.find((d) => d.canonicalDoseId === canonicalDoseId && d.administeredDate === administeredDate);
    if (existing) existing.records.push({ recordId, source });
    else result.doses.push({ id: recordId, canonicalDoseId, administeredDate,
      vaccineConceptUuid, sequenceNumber: dose.sequenceNumber,
      records: [{ recordId, source }] });
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
      if (protocols.length > 1 || protocols.some((p) => p.doseNumberString !== undefined ||
        !Number.isSafeInteger(p.doseNumberPositiveInt) || p.doseNumberPositiveInt! < 1)) {
        throw new Error('Ambiguous dose sequence');
      }
      const sequence = protocols[0]?.doseNumberPositiveInt;
      const candidates = new Set<string>();
      for (const coding of record.vaccineCode?.coding ?? []) {
        // O3/FHIR2's local concept UUID coding has no system. Never match on display text.
        if (!coding.system) {
          const specificDoses = dosesForConcept(coding.code, vaccineConceptUuids);
          if (specificDoses.length > 1) throw new Error('Vaccine/dose cannot be mapped unambiguously');
          const specific = specificDoses[0];
          if (specific) {
            // A dose-specific concept is sufficient on its own; conflicting sequence is unresolved.
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
              // Current national form has no administration-date Obs. Return date is NOT administration date.
              add(recordId, 'national-form', matches[0].id, encounter.encounterDatetime);
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
  return history.doses.filter((d) => d.canonicalDoseId === canonicalDoseId).flatMap((d) => d.records.map((r) => r.recordId));
}
