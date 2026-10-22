/**
 * ANC Date-of-TT save gate: the other half of the canonical tetanus sequence.
 * TT1–TT5 recorded on the ANC form and TD–TD5 recorded on the Immunization form
 * are the same five doses (Mercy's LE-563 clarification). Entering a TT date
 * here must not silently create a second, conflicting record of a dose already
 * known from either source — read through the same `consolidateHistory` as the
 * Immunization-form Td gate, so both sides of the sequence agree.
 *
 * This is a fact-entry gate, not an administration gate: it does not
 * re-validate the Td minimum-interval/prerequisite policy (that governs giving
 * a dose now, not recording when a past one happened), and it does not require
 * pregnancy status (the ANC encounter already establishes that context). It
 * blocks only a provable conflict with existing history, or a history that
 * cannot be read at all, never clinical timing.
 */
import { clinicalDate } from './clinical-date.ts';
import { CONFLICTING_DATES_ISSUE, consolidateHistory, type FhirImmunization, type NationalEncounter } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { ruleById } from './sequence-rules.ts';

export type TtGateCode = 'allowed' | 'history-conflict' | 'unresolved';

export function decideTtGate(input: {
  patientUuid?: string;
  canonicalDoseId?: string;
  ttDate?: string;
  editingEncounterUuid?: string;
  fhir?: readonly FhirImmunization[];
  encounters: readonly NationalEncounter[];
  config: SequenceIdentityConfig;
}): TtGateCode {
  const ttDate = input.ttDate?.trim() ?? '';
  if (!ttDate) {
    return 'allowed';
  }
  const patientUuid = input.patientUuid?.trim() ?? '';
  if (!patientUuid) {
    return 'unresolved';
  }
  const rule = input.canonicalDoseId ? ruleById(input.canonicalDoseId) : undefined;
  if (!rule || rule.series !== 'tetanus') {
    return 'unresolved';
  }
  let administeredDate: string;
  try {
    administeredDate = clinicalDate(ttDate);
  } catch {
    return 'unresolved';
  }
  const editing = input.editingEncounterUuid?.trim() ?? '';
  const encounters = editing ? input.encounters.filter((encounter) => encounter?.uuid !== editing) : input.encounters;
  try {
    const history = consolidateHistory({
      patientUuid,
      fhir: input.fhir ?? [],
      encounters,
      config: input.config,
    });
    const blocking = history.issues.filter((issue) => !issue.series || issue.series === rule.series);
    if (blocking.length) {
      return blocking.some((issue) => issue.message === CONFLICTING_DATES_ISSUE) ? 'history-conflict' : 'unresolved';
    }
    const vaccineConceptUuid = input.config.vaccineConceptUuids?.[rule.id]?.trim() ?? '';
    if (!vaccineConceptUuid) {
      return 'unresolved';
    }
    const existing = history.doses.find((dose) =>
      dose.vaccineConceptUuid === vaccineConceptUuid && dose.sequenceNumber === rule.sequenceNumber);
    if (existing && existing.administeredDate !== administeredDate) {
      return 'history-conflict';
    }
    return 'allowed';
  } catch {
    return 'unresolved';
  }
}
