import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPermissionDenied, restrictedSummarySections } from './permission.ts';

const has =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name);

describe('isPermissionDenied', () => {
  it('treats 401 and 403 as no access and leaves a real server error alone', () => {
    assert.equal(isPermissionDenied({ response: { status: 403 } }), true);
    assert.equal(isPermissionDenied({ status: 401 }), true);
    assert.equal(isPermissionDenied({ response: { status: 500 } }), false);
    assert.equal(isPermissionDenied(new Error('network')), false);
  });
});

describe('restrictedSummarySections', () => {
  it('names the cards a registrar cannot read', () => {
    assert.deepEqual(
      restrictedSummarySections(has('Get Patients', 'Get People')).map((section) => section.id),
      ['vitals', 'biometrics', 'conditions'],
    );
  });

  it('leaves the cards off for a user who can read both resources', () => {
    assert.deepEqual(restrictedSummarySections(has('Get Observations', 'Get Concepts')), []);
  });

  it('keeps conditions for a clinician who can read them and not vitals', () => {
    assert.deepEqual(
      restrictedSummarySections(has('Get Concepts', 'Manage General Consultation')).map((section) => section.id),
      ['vitals', 'biometrics'],
    );
  });
});
