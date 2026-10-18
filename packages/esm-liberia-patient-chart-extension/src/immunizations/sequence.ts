import { addDateOffset, evaluateEligibility, type AdministeredDose, type EligibilityStatus } from './eligibility.ts';
import { consolidateHistory, type FhirImmunization, type NationalEncounter } from './history.ts';
import { ruleById, toEligibilityRule, type SequenceIdentityConfig, type SequenceRule } from './sequence-rules.ts';

export type SequenceStatus = EligibilityStatus | 'UNRESOLVED';

export interface SequenceResult {
  status: SequenceStatus;
  canAdminister: boolean;
  scheduledDueDate?: string;
  intervalDate?: string;
  /** Later of the scheduled-age date and the predecessor's actual date plus any explicit interval. */
  eligibleDate?: string;
  matchingRecordIds: string[];
  issues: string[];
}

export function laterEligibleDate(scheduledDueDate: string, intervalDate?: string): string {
  if (intervalDate && intervalDate > scheduledDueDate) return intervalDate;
  return scheduledDueDate;
}

export function evaluateSequence(input: {
  patientUuid: string;
  doseId: string;
  birthDate: string;
  evaluationDate: string;
  fhir: readonly FhirImmunization[] | null | undefined;
  encounters: readonly NationalEncounter[] | null | undefined;
  config: SequenceIdentityConfig;
  editingRecordId?: string;
}): SequenceResult {
  const rule = ruleById(input.doseId);
  if (!rule) {
    return unresolved(['Unknown dose']);
  }
  const history = consolidateHistory(input);
  const blocking = history.issues.filter((issue) => !issue.series || issue.series === rule.series);
  if (blocking.length) return unresolved(blocking.map((issue) => issue.message));
  return evaluateDoseRule({
    birthDate: input.birthDate,
    evaluationDate: input.evaluationDate,
    rule,
    history: history.doses,
    vaccineConceptUuids: input.config.vaccineConceptUuids,
  });
}

export function evaluateDoseRule(input: {
  birthDate: string;
  evaluationDate: string;
  rule: SequenceRule;
  history: readonly AdministeredDose[];
  vaccineConceptUuids: Readonly<Record<string, string>>;
}): SequenceResult {
  try {
    const eligibilityRule = toEligibilityRule(input.rule, input.vaccineConceptUuids);
    const intervalDate = intervalFromHistory(input.rule, input.evaluationDate, input.history, input.vaccineConceptUuids);
    const result = evaluateEligibility({
      birthDate: input.birthDate,
      evaluationDate: input.evaluationDate,
      rule: eligibilityRule,
      history: input.history,
    });
    const eligibleDate = input.rule.prerequisiteId
      ? (intervalDate ? laterEligibleDate(result.scheduledDueDate, intervalDate) : undefined)
      : result.scheduledDueDate;
    return {
      ...result,
      ...(intervalDate ? { intervalDate } : {}),
      ...(eligibleDate ? { eligibleDate } : {}),
      issues: [],
    };
  } catch (error) {
    return unresolved([error instanceof Error ? error.message : 'Unresolved history']);
  }
}

function intervalFromHistory(
  rule: SequenceRule,
  evaluationDate: string,
  history: readonly AdministeredDose[],
  vaccineConceptUuids: Readonly<Record<string, string>>,
): string | undefined {
  if (!rule.prerequisiteId) return undefined;
  const eligibilityRule = toEligibilityRule(rule, vaccineConceptUuids);
  const predecessor = eligibilityRule.prerequisite?.dose;
  if (!predecessor) return undefined;
  const prior = history.filter((record) =>
    record.vaccineConceptUuid === predecessor.vaccineConceptUuid &&
    record.sequenceNumber === predecessor.sequenceNumber &&
    record.administeredDate <= evaluationDate);
  if (prior.length !== 1) return undefined;
  return addDateOffset(prior[0].administeredDate, rule.minimumInterval ?? { value: 0, unit: 'days' });
}

function unresolved(issues: string[]): SequenceResult {
  return { status: 'UNRESOLVED', canAdminister: false, matchingRecordIds: [], issues };
}
