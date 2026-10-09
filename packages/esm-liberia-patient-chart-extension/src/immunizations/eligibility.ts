/** Date-only, policy-injected eligibility. No clinical schedule or I/O belongs here. */
export interface Offset {
  value: number;
  unit: 'days' | 'weeks' | 'months' | 'years';
}

export interface DoseIdentity {
  vaccineConceptUuid: string;
  sequenceNumber: number;
}

export interface EligibilityRule extends DoseIdentity {
  dueAge: Offset;
  upperAge?: { age: Offset; inclusive: boolean };
  prerequisite?: { dose: DoseIdentity; minimumInterval?: Offset };
  /** null keeps eligible doses DUE; 0 makes the day after due OVERDUE. No default. */
  overdueAfterDays: number | null;
}

/** Adapter must supply complete, reconciled, completed/non-voided history for this patient. */
export interface AdministeredDose extends DoseIdentity {
  id: string;
  administeredDate: string;
}

export type EligibilityStatus =
  | 'NOT_YET_DUE'
  | 'DUE'
  | 'OVERDUE'
  | 'WAITING_FOR_PREREQUISITE'
  | 'WAITING_FOR_INTERVAL'
  | 'ADMINISTERED'
  | 'NOT_ELIGIBLE';

export interface EligibilityResult {
  status: EligibilityStatus;
  canAdminister: boolean;
  scheduledDueDate: string;
  intervalDate?: string;
  matchingRecordIds: string[];
}

function integer(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Expected a non-negative integer');
}

function date(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected a complete YYYY-MM-DD date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '0001-01-01') {
    throw new Error('Invalid calendar date');
  }
  return parsed;
}

function format(value: Date): string {
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) {
    throw new Error('Date outside supported range');
  }
  return value.toISOString().slice(0, 10);
}

/** Days/weeks are calendar days; months/years clamp to the target month's last day. */
export function addDateOffset(value: string, offset: Offset): string {
  const result = date(value);
  integer(offset.value);
  if (offset.unit === 'days' || offset.unit === 'weeks') {
    result.setUTCDate(result.getUTCDate() + offset.value * (offset.unit === 'weeks' ? 7 : 1));
  } else if (offset.unit === 'months' || offset.unit === 'years') {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + offset.value * (offset.unit === 'years' ? 12 : 1));
    const last = new Date(result.getTime());
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    result.setUTCDate(Math.min(day, last.getUTCDate()));
  } else {
    throw new Error('Unsupported offset unit');
  }
  return format(result);
}

function validateIdentity(dose: DoseIdentity) {
  if (!dose.vaccineConceptUuid?.trim()) throw new Error('Missing vaccine identity');
  integer(dose.sequenceNumber);
  if (dose.sequenceNumber < 1) throw new Error('FHIR dose sequence must be positive');
}

function matches(left: DoseIdentity, right: DoseIdentity): boolean {
  return left.vaccineConceptUuid === right.vaccineConceptUuid && left.sequenceNumber === right.sequenceNumber;
}

/**
 * evaluationDate is the entered vaccination date, or today's facility date for a dashboard.
 * Errors mean invalid/incomplete input, never permission to administer. There is no clock default.
 * Duplicate checks use every matching record in the supplied history, including doses dated
 * after a backdated evaluation date. Prerequisite checks use only doses dated on or before it.
 */
export function evaluateEligibility(input: {
  birthDate: string;
  evaluationDate: string;
  rule: EligibilityRule;
  history: readonly AdministeredDose[];
  editingRecordId?: string;
}): EligibilityResult {
  const { birthDate, evaluationDate, rule, history, editingRecordId } = input;
  date(birthDate);
  date(evaluationDate);
  if (evaluationDate < birthDate) throw new Error('Evaluation date precedes birth');
  validateIdentity(rule);
  if (rule.overdueAfterDays !== null) integer(rule.overdueAfterDays);
  const scheduledDueDate = addDateOffset(birthDate, rule.dueAge);
  const upper = rule.upperAge ? addDateOffset(birthDate, rule.upperAge.age) : undefined;
  // An exclusive upper equal to the due date admits no eligible day. A closed window is an inclusive upper.
  if (rule.upperAge && (typeof rule.upperAge.inclusive !== 'boolean' || upper! < scheduledDueDate ||
    (!rule.upperAge.inclusive && upper === scheduledDueDate))) {
    throw new Error('Invalid upper-age policy');
  }
  if (rule.prerequisite) {
    validateIdentity(rule.prerequisite.dose);
    if (matches(rule, rule.prerequisite.dose)) throw new Error('Dose cannot require itself');
    if (rule.prerequisite.minimumInterval) addDateOffset(birthDate, rule.prerequisite.minimumInterval);
  }
  if (!Array.isArray(history)) throw new Error('Complete history required');
  const ids = new Set<string>();
  for (const record of history) {
    validateIdentity(record);
    date(record.administeredDate);
    if (!record.id || ids.has(record.id) || record.administeredDate < birthDate) {
      throw new Error('Invalid or unreconciled history');
    }
    ids.add(record.id);
  }
  const otherRecords = history.filter((record) => record.id !== editingRecordId);
  const matchingRecordIds = otherRecords.filter((record) => matches(record, rule)).map((record) => record.id);
  const result = (status: EligibilityStatus, intervalDate?: string): EligibilityResult => ({
    status,
    canAdminister: status === 'DUE' || status === 'OVERDUE',
    scheduledDueDate,
    matchingRecordIds,
    ...(intervalDate ? { intervalDate } : {}),
  });
  const beyondUpper = (day: string) =>
    !!rule.upperAge && !!upper && (day > upper || (!rule.upperAge.inclusive && day === upper));
  if (matchingRecordIds.length) return result('ADMINISTERED');
  if (beyondUpper(evaluationDate)) return result('NOT_ELIGIBLE');
  if (evaluationDate < scheduledDueDate) return result('NOT_YET_DUE');
  let intervalDate: string | undefined;
  if (rule.prerequisite) {
    const prior = otherRecords.filter((record) => matches(record, rule.prerequisite!.dose));
    if (prior.length > 1) throw new Error('Prerequisite history needs reconciliation');
    if (!prior.length || prior[0].administeredDate > evaluationDate) return result('WAITING_FOR_PREREQUISITE');
    intervalDate = addDateOffset(prior[0].administeredDate, rule.prerequisite.minimumInterval ?? { value: 0, unit: 'days' });
    if (evaluationDate < intervalDate) {
      // The interval date is already outside the upper boundary, so waiting cannot make the dose eligible.
      return result(beyondUpper(intervalDate) ? 'NOT_ELIGIBLE' : 'WAITING_FOR_INTERVAL', intervalDate);
    }
  }
  const overdue = rule.overdueAfterDays !== null &&
    evaluationDate > addDateOffset(scheduledDueDate, { value: rule.overdueAfterDays, unit: 'days' });
  return result(overdue ? 'OVERDUE' : 'DUE', intervalDate);
}
