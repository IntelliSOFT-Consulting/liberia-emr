import { clinicalDate } from './clinical-date.ts';
import { addDateOffset, evaluateEligibility, type Offset } from './eligibility.ts';
import { routineSchedule, resolveRoutineDose } from './routine-schedule.ts';
import { sequenceRules } from './sequence-rules.ts';

/**
 * BCG and OPV0 save/hide check for the national Immunization form.
 * The age window is the routine-schedule policy, evaluated by evaluateEligibility.
 * Other vaccines are not decided here. Incomplete dates fail closed.
 */
export function routineDoseOutsideWindow(
  birthDate: unknown,
  evaluationDate: unknown,
  vaccineConceptUuid: unknown,
  bcgConceptUuid: unknown,
  opv0ConceptUuid: unknown,
): boolean {
  const vaccine = text(vaccineConceptUuid);
  const bcg = text(bcgConceptUuid);
  const opv0 = text(opv0ConceptUuid);
  const id = vaccine && bcg && vaccine === bcg ? 'BCG' : vaccine && opv0 && vaccine === opv0 ? 'OPV0' : '';
  if (!id) return false;
  const birth = calendarIso(birthDate);
  const evaluation = calendarIso(evaluationDate);
  if (!birth || !evaluation) return true;
  const policy = routineSchedule.find((dose) => dose.id === id);
  if (!policy?.upperAge) return true;
  try {
    const rule = resolveRoutineDose(policy, { [id]: vaccine });
    const result = evaluateEligibility({ birthDate: birth, evaluationDate: evaluation, rule, history: [] });
    return result.status === 'NOT_ELIGIBLE';
  } catch {
    return true;
  }
}

/**
 * Future return date for the next dose in the existing schedule.
 * A routine-schedule prerequisite wins. A sequence-rule successor uses that
 * rule's interval, and the routine schedule's due age when the successor is
 * also a routine dose. Empty means this dose has no future next dose.
 * `doseMap` is `CanonicalId=${conceptUuid}` pairs, comma-separated.
 */
export function routineNextDoseDate(
  birthDate: unknown,
  evaluationDate: unknown,
  vaccineConceptUuid: unknown,
  doseMap: unknown,
): string {
  const id = conceptIds(doseMap).get(text(vaccineConceptUuid));
  const birth = calendarIso(birthDate);
  const evaluation = calendarIso(evaluationDate);
  if (!id || !birth || !evaluation) return '';
  const next = successor(id);
  if (!next) return '';
  try {
    const due = addDateOffset(birth, next.dueAge);
    const interval = next.minimumInterval ? addDateOffset(evaluation, next.minimumInterval) : undefined;
    const date = interval && interval > due ? interval : due;
    return date > evaluation ? date : '';
  } catch {
    return '';
  }
}

function successor(id: string): { dueAge: Offset; minimumInterval?: Offset } | null {
  const routine = routineSchedule.find((dose) => dose.prerequisite?.canonicalDoseId === id);
  if (routine) {
    return { dueAge: routine.dueAge, minimumInterval: routine.prerequisite?.minimumInterval };
  }
  const sequence = sequenceRules.find((rule) => rule.prerequisiteId === id);
  if (!sequence) return null;
  const routineSuccessor = routineSchedule.find((dose) => dose.id === sequence.id);
  if (routineSuccessor) {
    return {
      dueAge: routineSuccessor.dueAge,
      minimumInterval: routineSuccessor.prerequisite?.minimumInterval ?? sequence.minimumInterval,
    };
  }
  return { dueAge: sequence.dueAge, minimumInterval: sequence.minimumInterval };
}

function conceptIds(doseMap: unknown): Map<string, string> {
  const ids = new Map<string, string>();
  for (const part of text(doseMap).split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const id = part.slice(0, separator).trim();
    const uuid = part.slice(separator + 1).trim();
    if (id && uuid) ids.set(uuid, id);
  }
  return ids;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function calendarIso(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return validIso(`${value.getFullYear()}-${month}-${day}`);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const textValue = value.trim();
  const direct = validIso(textValue);
  if (direct) return direct;
  const prefix = textValue.match(/^(\d{4}-\d{2}-\d{2})/);
  return prefix ? validIso(prefix[1]) : null;
}

function validIso(value: string): string | null {
  try {
    return clinicalDate(value);
  } catch {
    return null;
  }
}
