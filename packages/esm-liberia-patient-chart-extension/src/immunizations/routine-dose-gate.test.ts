import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateEligibility } from './eligibility.ts';
import { routineDoseOutsideWindow, routineNextDoseDate } from './routine-dose-gate.ts';
import { resolveRoutineDose, routineSchedule } from './routine-schedule.ts';

const bcg = 'bcg-concept';
const opv0 = 'opv0-concept';
const map = [
  'BCG=bcg-concept',
  'OPV0=opv0-concept',
  'OPV1=opv1-concept',
  'Malaria1=malaria1-concept',
  'IPV=ipv-concept',
  'TD1=td1-concept',
  'TD5=td5-concept',
  'PediatricPfizer1=pfizer1-concept',
  'PediatricPfizer2=pfizer2-concept',
  'HPV1=hpv1-concept',
  'HPV2=hpv2-concept',
].join(',');

function scheduledOutside(id: 'BCG' | 'OPV0', birthDate: string, evaluationDate: string) {
  const policy = routineSchedule.find((dose) => dose.id === id);
  assert.ok(policy);
  const vaccine = id === 'BCG' ? bcg : opv0;
  const rule = resolveRoutineDose(policy, { [id]: vaccine });
  const result = evaluateEligibility({ birthDate, evaluationDate, rule, history: [] });
  return result.status === 'NOT_ELIGIBLE';
}

describe('routine dose window', () => {
  it('uses the schedule evaluator for BCG before 11 months', () => {
    const birth = '2024-01-31';
    assert.equal(routineDoseOutsideWindow(birth, '2024-01-31', bcg, bcg, opv0), scheduledOutside('BCG', birth, '2024-01-31'));
    assert.equal(routineDoseOutsideWindow(birth, '2024-12-30', bcg, bcg, opv0), false);
    assert.equal(scheduledOutside('BCG', birth, '2024-12-30'), false);
    assert.equal(routineDoseOutsideWindow(birth, '2024-12-31', bcg, bcg, opv0), true);
    assert.equal(scheduledOutside('BCG', birth, '2024-12-31'), true);
  });

  it('uses the schedule evaluator for OPV0 on days 0 through 7', () => {
    const birth = '2024-01-01';
    assert.equal(routineDoseOutsideWindow(birth, '2024-01-01', opv0, bcg, opv0), false);
    assert.equal(scheduledOutside('OPV0', birth, '2024-01-01'), false);
    assert.equal(routineDoseOutsideWindow(birth, '2024-01-08', opv0, bcg, opv0), false);
    assert.equal(scheduledOutside('OPV0', birth, '2024-01-08'), false);
    assert.equal(routineDoseOutsideWindow(birth, '2024-01-09', opv0, bcg, opv0), true);
    assert.equal(scheduledOutside('OPV0', birth, '2024-01-09'), true);
  });

  it('leaves other vaccines to their existing gates and fails closed without a usable date', () => {
    assert.equal(routineDoseOutsideWindow('2024-01-01', '2024-06-01', 'penta-1', bcg, opv0), false);
    assert.equal(routineDoseOutsideWindow('', '2024-01-01', bcg, bcg, opv0), true);
    assert.equal(routineDoseOutsideWindow('2024-01-01', '', opv0, bcg, opv0), true);
    assert.equal(routineDoseOutsideWindow('not-a-date', '2024-01-01', bcg, bcg, opv0), true);
  });
});

describe('next dose return date', () => {
  it('follows the existing successor and leaves a final dose without a return date', () => {
    assert.equal(routineNextDoseDate('2024-01-01', '2024-02-12', 'opv1-concept', map), '2024-03-11');
    assert.equal(routineNextDoseDate('2024-01-01', '2024-03-01', 'opv1-concept', map), '2024-03-29');
    assert.equal(routineNextDoseDate('2024-01-01', '2024-06-01', 'malaria1-concept', map), '2024-07-01');
    assert.equal(routineNextDoseDate('2024-01-01', '2024-08-01', 'malaria1-concept', map), '');
    assert.equal(routineNextDoseDate('1990-01-01', '2024-06-01', 'td1-concept', map), '2024-06-29');
    assert.equal(routineNextDoseDate('2019-01-01', '2024-06-01', 'pfizer1-concept', map), '2024-06-29');
    assert.equal(routineNextDoseDate('2015-01-01', '2024-06-01', 'hpv1-concept', map), '2024-12-01');
    for (const concept of ['bcg-concept', 'opv0-concept', 'ipv-concept', 'td5-concept', 'pfizer2-concept', 'hpv2-concept']) {
      assert.equal(routineNextDoseDate('2024-01-01', '2024-06-01', concept, map), '', concept);
    }
  });

  it('returns no date when the birth date, evaluation date, or vaccine cannot be read', () => {
    assert.equal(routineNextDoseDate('', '2024-02-12', 'opv1-concept', map), '');
    assert.equal(routineNextDoseDate('2024-01-01', 'later', 'opv1-concept', map), '');
    assert.equal(routineNextDoseDate('2024-01-01', '2024-02-12', 'unknown', map), '');
  });
});
