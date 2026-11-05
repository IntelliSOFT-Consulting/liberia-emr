import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encounterSignature, isPatientFlagsKey } from './patient-flags-key.ts';

const base = '/ws/rest/v1';

test('matches the flags app key for the patient', () => {
  assert.equal(isPatientFlagsKey(`${base}/patientflags/patientflag?patient=p1&v=full`, base, 'p1'), true);
});

test('ignores other patients, other resources and non-string keys', () => {
  assert.equal(isPatientFlagsKey(`${base}/patientflags/patientflag?patient=p10&v=full`, base, 'p1'), false);
  assert.equal(isPatientFlagsKey(`${base}/patientflags/flag?v=full`, base, 'p1'), false);
  assert.equal(isPatientFlagsKey(`${base}/encounter?patient=p1&v=full`, base, 'p1'), false);
  assert.equal(isPatientFlagsKey(['x', 'p1'], base, 'p1'), false);
});

test('encounter signature changes on add or remove only', () => {
  const before = encounterSignature([{ uuid: 'a' }, { uuid: 'b' }]);
  assert.equal(encounterSignature([{ uuid: 'b' }, { uuid: 'a' }]), before);
  assert.notEqual(encounterSignature([{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }]), before);
  assert.notEqual(encounterSignature([{ uuid: 'a' }]), before);
});
