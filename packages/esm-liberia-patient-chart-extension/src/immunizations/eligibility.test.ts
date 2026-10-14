import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDateOffset, evaluateEligibility, type AdministeredDose, type EligibilityRule } from './eligibility.ts';

// Synthetic fixtures, not a national clinical schedule.
const rule: EligibilityRule = {
  vaccineConceptUuid: 'fixture-vaccine', sequenceNumber: 2,
  dueAge: { value: 6, unit: 'weeks' }, overdueAfterDays: 0,
};
const birthDate = '2024-01-01';
const prior: AdministeredDose = {
  id: 'prior', vaccineConceptUuid: rule.vaccineConceptUuid, sequenceNumber: 1, administeredDate: '2024-01-20',
};
const withPrerequisite: EligibilityRule = {
  ...rule, prerequisite: { dose: prior, minimumInterval: { value: 28, unit: 'days' } },
};
function evaluate(evaluationDate: string, schedule = rule, history: AdministeredDose[] = []) {
  return evaluateEligibility({ birthDate, evaluationDate, rule: schedule, history });
}

describe('calendar arithmetic', () => {
  for (const [dob, value, unit, expected] of [
    ['2024-01-01', 41, 'days', '2024-02-11'],
    ['2024-01-01', 6, 'weeks', '2024-02-12'],
    ['2024-01-31', 1, 'months', '2024-02-29'],
    ['2023-01-31', 1, 'months', '2023-02-28'],
    ['2024-01-31', 2, 'months', '2024-03-31'],
    ['2024-01-31', 9, 'months', '2024-10-31'],
    ['2024-01-31', 15, 'months', '2025-04-30'],
    ['2024-02-29', 1, 'years', '2025-02-28'],
    ['2024-02-29', 4, 'years', '2028-02-29'],
    ['2024-03-09', 2, 'days', '2024-03-11'],
  ] as const) {
    it(`${dob} + ${value} ${unit} = ${expected}`, () => {
      assert.equal(addDateOffset(dob, { value, unit }), expected);
    });
  }
  it('rejects invalid, partial and timestamp dates', () => {
    for (const value of ['2023-02-29', '2024-02-30', '2024-01', '0000-01-01', '2024-01-01T00:00:00Z']) {
      assert.throws(() => addDateOffset(value, { value: 0, unit: 'days' }));
    }
    assert.throws(() => addDateOffset(birthDate, { value: -1, unit: 'days' }));
    assert.throws(() => addDateOffset(birthDate, { value: 1.5, unit: 'weeks' }));
    assert.throws(() => addDateOffset('9999-12-31', { value: 1, unit: 'days' }));
  });
});

describe('eligibility', () => {
  for (const [day, status, allowed] of [
    ['2024-02-11', 'NOT_YET_DUE', false],
    ['2024-02-12', 'DUE', true],
    ['2024-02-13', 'OVERDUE', true],
    ['2025-02-13', 'OVERDUE', true],
  ] as const) {
    it(`${day}: ${status}`, () => {
      const result = evaluate(day);
      assert.equal(result.status, status);
      assert.equal(result.canAdminister, allowed);
      assert.equal(result.scheduledDueDate, '2024-02-12');
    });
  }
  it('uses an explicit overdue policy', () => {
    assert.equal(evaluate('2024-02-13', { ...rule, overdueAfterDays: null }).status, 'DUE');
    assert.equal(evaluate('2024-02-14', { ...rule, overdueAfterDays: 2 }).status, 'DUE');
    assert.equal(evaluate('2024-02-15', { ...rule, overdueAfterDays: 2 }).status, 'OVERDUE');
  });
  it('honours both forms of upper boundary', () => {
    const bounded = { ...rule, upperAge: { age: { value: 7, unit: 'weeks' as const }, inclusive: true } };
    assert.equal(evaluate('2024-02-19', bounded).canAdminister, true);
    assert.equal(evaluate('2024-02-20', bounded).status, 'NOT_ELIGIBLE');
    assert.equal(evaluate('2024-02-19', { ...bounded, upperAge: { ...bounded.upperAge, inclusive: false } }).status, 'NOT_ELIGIBLE');
    const exactDay = { ...rule, upperAge: { age: rule.dueAge, inclusive: true } };
    assert.equal(evaluate('2024-02-12', exactDay).status, 'DUE');
    assert.equal(evaluate('2024-02-13', exactDay).status, 'NOT_ELIGIBLE');
  });
  it('is due on the date of birth when the due offset is zero days', () => {
    const result = evaluateEligibility({
      birthDate, evaluationDate: birthDate, history: [],
      rule: { ...rule, dueAge: { value: 0, unit: 'days' } },
    });
    assert.equal(result.status, 'DUE');
    assert.equal(result.canAdminister, true);
    assert.equal(result.scheduledDueDate, birthDate);
  });
  it('requires the prerequisite and its interval', () => {
    assert.equal(evaluate('2024-02-12', withPrerequisite).status, 'WAITING_FOR_PREREQUISITE');
    const waiting = evaluate('2024-02-16', withPrerequisite, [prior]);
    assert.equal(waiting.status, 'WAITING_FOR_INTERVAL');
    assert.equal(waiting.intervalDate, '2024-02-17');
    assert.equal(waiting.canAdminister, false);
    assert.equal(evaluate('2024-02-17', withPrerequisite, [prior]).canAdminister, true);
    assert.equal(evaluate('2024-02-12', { ...rule, prerequisite: { dose: prior } }, [prior]).status, 'DUE');
  });
  it('does not satisfy a backdated prerequisite with a later administration', () => {
    assert.equal(evaluate('2024-02-12', withPrerequisite, [{ ...prior, administeredDate: '2024-02-13' }]).status,
      'WAITING_FOR_PREREQUISITE');
  });
  it('matches vaccine AND sequence, with duplicate prevention across all dates', () => {
    const received = { ...prior, id: 'received', sequenceNumber: 2, administeredDate: '2024-03-01' };
    const result = evaluate('2024-02-12', rule, [prior, received]);
    assert.equal(result.status, 'ADMINISTERED');
    assert.equal(result.canAdminister, false);
    assert.deepEqual(result.matchingRecordIds, ['received']);
    assert.equal(evaluate('2024-02-12', rule, [{ ...received, vaccineConceptUuid: 'another-vaccine' }]).status, 'DUE');
    assert.equal(evaluate('2024-02-12', rule, [prior]).status, 'DUE');
    assert.equal(evaluateEligibility({ birthDate, evaluationDate: '2024-02-12', rule, history: [received],
      editingRecordId: 'received' }).status, 'DUE');
  });
  it('preserves ADMINISTERED outside the eligibility window', () => {
    const bounded = { ...rule, upperAge: { age: { value: 7, unit: 'weeks' as const }, inclusive: true } };
    assert.equal(evaluate('2024-02-20', bounded, [{ ...prior, sequenceNumber: 2 }]).status, 'ADMINISTERED');
  });
  it('stays ADMINISTERED when another duplicate remains while one record is edited', () => {
    const first = { ...prior, id: 'first', sequenceNumber: 2, administeredDate: '2024-03-01' };
    const second = { ...prior, id: 'second', sequenceNumber: 2, administeredDate: '2024-04-01' };
    const result = evaluateEligibility({
      birthDate, evaluationDate: '2024-02-12', rule, history: [first, second], editingRecordId: 'first',
    });
    assert.equal(result.status, 'ADMINISTERED');
    assert.equal(result.canAdminister, false);
    assert.deepEqual(result.matchingRecordIds, ['second']);
  });
  it('is not eligible when the prerequisite interval falls after the upper bound', () => {
    const bounded: EligibilityRule = {
      ...withPrerequisite,
      upperAge: { age: { value: 44, unit: 'days' }, inclusive: true },
    };
    const result = evaluate('2024-02-12', bounded, [prior]);
    assert.equal(result.intervalDate, '2024-02-17');
    assert.equal(result.status, 'NOT_ELIGIBLE');
    assert.equal(result.canAdminister, false);
    const exclusive = evaluate('2024-02-16', {
      ...withPrerequisite,
      upperAge: { age: { value: 47, unit: 'days' as const }, inclusive: false },
    }, [prior]);
    assert.equal(exclusive.intervalDate, '2024-02-17');
    assert.equal(exclusive.status, 'NOT_ELIGIBLE');
  });
  it('recalculates with each explicit evaluation date', () => {
    assert.equal(evaluate('2024-02-13').status, 'OVERDUE');
    assert.equal(evaluate('2024-02-11').status, 'NOT_YET_DUE');
  });
  for (const [months, before, exact] of [[9, '2024-10-30', '2024-10-31'], [15, '2025-04-29', '2025-04-30']] as const) {
    it(`handles the exact ${months}-month boundary`, () => {
      const input = { birthDate: '2024-01-31', rule: { ...rule, dueAge: { value: months, unit: 'months' as const } }, history: [] };
      assert.equal(evaluateEligibility({ ...input, evaluationDate: before }).status, 'NOT_YET_DUE');
      assert.equal(evaluateEligibility({ ...input, evaluationDate: exact }).status, 'DUE');
    });
  }
  it('rejects incomplete policy or ambiguous history', () => {
    assert.throws(() => evaluate('2023-12-31'));
    assert.throws(() => evaluate('2024-02-12', { ...rule, overdueAfterDays: undefined } as unknown as EligibilityRule));
    assert.throws(() => evaluate('2024-02-12', { ...rule, sequenceNumber: 0 }));
    assert.throws(() => evaluate('2024-02-12', { ...rule, prerequisite: { dose: rule } }));
    assert.throws(() => evaluate('2024-02-12', withPrerequisite, [prior, { ...prior, id: 'duplicate' }]));
    assert.throws(() => evaluate('2024-02-12', rule, [prior, prior]));
    assert.throws(() => evaluate('2024-02-12', rule, null as unknown as AdministeredDose[]));
    assert.throws(() => evaluate('2024-02-12', { ...rule,
      upperAge: { age: { value: 1, unit: 'weeks' }, inclusive: true } }));
  });
  it('rejects an exclusive upper bound equal to the due date', () => {
    assert.throws(() => evaluate('2024-02-12', {
      ...rule, upperAge: { age: rule.dueAge, inclusive: false },
    }));
  });
});
