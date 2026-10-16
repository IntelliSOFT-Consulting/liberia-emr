import schedule from './routine-schedule.json' with { type: 'json' };
import { evaluateEligibility, type EligibilityRule, type EligibilityStatus } from './eligibility.ts';
import type { NormalizedHistory } from './history';

export interface RoutineDose extends EligibilityRule { id: string; label: string }

/** LE-559 approved policy. National dose-specific concepts use internal sequence 1,
 * including OPV0. This is NOT a guess about generic OPV FHIR dose numbering. */
export const routineSchedule = schedule as RoutineDose[];
export type RoutineStatus = Exclude<EligibilityStatus, 'NOT_ELIGIBLE'> |
  'OUTSIDE_ELIGIBILITY_WINDOW' | 'HISTORY_UNRESOLVED';

export function evaluateRoutineSchedule(birthDate: string, evaluationDate: string, history: NormalizedHistory) {
  return routineSchedule.map((dose) => {
    try {
      const result = evaluateEligibility({ birthDate, evaluationDate, rule: dose, history: history.doses });
      if (history.issues.length && result.status !== 'ADMINISTERED') throw new Error('History needs reconciliation');
      const eligibleDate = dose.prerequisite?.minimumInterval && result.intervalDate && result.intervalDate > result.scheduledDueDate
        ? result.intervalDate : result.scheduledDueDate;
      const status: RoutineStatus = result.status === 'NOT_ELIGIBLE' ? 'OUTSIDE_ELIGIBILITY_WINDOW'
        // The first day allowed after an explicit interval is DUE, even after a late prerequisite.
        : result.canAdminister && evaluationDate === eligibleDate ? 'DUE' : result.status;
      return { dose, ...result, status, eligibleDate, reason: undefined as string | undefined };
    } catch (error) {
      return { dose, status: 'HISTORY_UNRESOLVED' as RoutineStatus, canAdminister: false,
        scheduledDueDate: undefined, eligibleDate: undefined, matchingRecordIds: [],
        reason: error instanceof Error ? error.message : 'Invalid eligibility inputs' };
    }
  });
}
