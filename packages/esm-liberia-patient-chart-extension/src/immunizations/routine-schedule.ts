import schedule from './routine-schedule.json' with { type: 'json' };
import { evaluateEligibility, type EligibilityRule, type EligibilityStatus, type Offset } from './eligibility.ts';
import type { NormalizedHistory } from './history';

/** Schedule policy only. Vaccine concept UUIDs come from runtime config. */
export interface RoutineScheduleDose {
  id: string;
  label: string;
  sequenceNumber: number;
  dueAge: Offset;
  overdueAfterDays: number | null;
  upperAge?: EligibilityRule['upperAge'];
  prerequisite?: { canonicalDoseId: string; minimumInterval?: Offset };
}

export interface RoutineDose extends EligibilityRule { id: string; label: string }

/** LE-559 approved policy. Prerequisites name a canonical dose, not a concept UUID.
 * National dose-specific concepts use internal sequence 1, including OPV0.
 * This is NOT a guess about generic OPV FHIR dose numbering. */
export const routineSchedule = schedule as RoutineScheduleDose[];
export type RoutineStatus = Exclude<EligibilityStatus, 'NOT_ELIGIBLE'> |
  'OUTSIDE_ELIGIBILITY_WINDOW' | 'HISTORY_UNRESOLVED';

export function resolveRoutineDose(
  dose: RoutineScheduleDose,
  vaccineConceptUuids: Readonly<Record<string, string>>,
): RoutineDose {
  const prerequisitePolicy = dose.prerequisite;
  let prerequisite: EligibilityRule['prerequisite'];
  if (prerequisitePolicy) {
    const prior = routineSchedule.find((item) => item.id === prerequisitePolicy.canonicalDoseId);
    if (!prior) throw new Error('Unknown canonical dose');
    prerequisite = {
      dose: {
        vaccineConceptUuid: vaccineConceptUuids[prior.id]?.trim() ?? '',
        sequenceNumber: prior.sequenceNumber,
      },
      ...(prerequisitePolicy.minimumInterval ? { minimumInterval: prerequisitePolicy.minimumInterval } : {}),
    };
  }
  return {
    id: dose.id,
    label: dose.label,
    vaccineConceptUuid: vaccineConceptUuids[dose.id]?.trim() ?? '',
    sequenceNumber: dose.sequenceNumber,
    dueAge: dose.dueAge,
    overdueAfterDays: dose.overdueAfterDays,
    ...(dose.upperAge ? { upperAge: dose.upperAge } : {}),
    ...(prerequisite ? { prerequisite } : {}),
  };
}

export function evaluateRoutineSchedule(
  birthDate: string,
  evaluationDate: string,
  history: NormalizedHistory,
  vaccineConceptUuids: Readonly<Record<string, string>>,
) {
  return routineSchedule.map((policy) => {
    const fallback = (): RoutineDose => ({
      id: policy.id,
      label: policy.label,
      vaccineConceptUuid: vaccineConceptUuids[policy.id]?.trim() ?? '',
      sequenceNumber: policy.sequenceNumber,
      dueAge: policy.dueAge,
      overdueAfterDays: policy.overdueAfterDays,
      ...(policy.upperAge ? { upperAge: policy.upperAge } : {}),
    });
    try {
      const dose = resolveRoutineDose(policy, vaccineConceptUuids);
      const result = evaluateEligibility({ birthDate, evaluationDate, rule: dose, history: history.doses });
      if (history.issues.length && result.status !== 'ADMINISTERED') throw new Error('History needs reconciliation');
      const eligibleDate = dose.prerequisite?.minimumInterval && result.intervalDate && result.intervalDate > result.scheduledDueDate
        ? result.intervalDate : result.scheduledDueDate;
      const status: RoutineStatus = result.status === 'NOT_ELIGIBLE' ? 'OUTSIDE_ELIGIBILITY_WINDOW'
        // The first day allowed after an explicit interval is DUE, even after a late prerequisite.
        : result.canAdminister && evaluationDate === eligibleDate ? 'DUE' : result.status;
      return { dose, ...result, status, eligibleDate, reason: undefined as string | undefined };
    } catch (error) {
      return { dose: fallback(), status: 'HISTORY_UNRESOLVED' as RoutineStatus, canAdminister: false,
        scheduledDueDate: undefined, eligibleDate: undefined, matchingRecordIds: [],
        reason: error instanceof Error ? error.message : 'Invalid eligibility inputs' };
    }
  });
}
