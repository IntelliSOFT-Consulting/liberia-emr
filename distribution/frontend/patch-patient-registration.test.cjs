'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __liberiaEmrHiddenElements: hidden, __liberiaEmrSanitize: sanitize } = require('./patch-patient-registration.cjs');

const yes = 'yes-concept';
const no = 'no-concept';

// The shape of the national referral config: a radio toggle gating the referral section.
const config = {
  sections: ['demographics', 'referral', 'referralDetails'],
  sectionDefinitions: [
    { id: 'referral', fields: ['patientReferred'] },
    {
      id: 'referralDetails',
      fields: ['referredFrom', 'reasonForReferral'],
      hideIf: { fieldId: 'patientReferred', notEquals: yes },
    },
  ],
  fieldDefinitions: [
    { id: 'patientReferred', type: 'person attribute', uuid: 'referred-uuid', displayStyle: 'radio' },
    { id: 'referredFrom', type: 'person attribute', uuid: 'from-uuid' },
    { id: 'reasonForReferral', type: 'person attribute', uuid: 'reason-uuid' },
    { id: 'adultOnly', type: 'obs', uuid: 'adult-obs', hideIfAge: { operator: '<', value: 18 } },
  ],
  fieldConfigurations: {},
};

test('referral details stay hidden until Yes is selected', () => {
  for (const referred of [undefined, '', no]) {
    const { sectionIds, fieldIds } = hidden({ attributes: { 'referred-uuid': referred } }, config);
    assert.deepEqual([...sectionIds], ['referralDetails']);
    assert.deepEqual([...fieldIds].sort(), ['reasonForReferral', 'referredFrom']);
  }
  const shown = hidden({ attributes: { 'referred-uuid': yes } }, config);
  assert.equal(shown.sectionIds.size, 0);
  assert.equal(shown.fieldIds.has('referredFrom'), false);
});

test('referral values typed before switching back to No are not saved', () => {
  const values = {
    attributes: { 'referred-uuid': no, 'from-uuid': 'JFK', 'reason-uuid': 'Surgery', other: 'kept' },
    obs: {},
  };
  const saved = sanitize(values, config, { address: {} });
  assert.deepEqual(saved.attributes, { 'referred-uuid': no, other: 'kept' });
  assert.equal(values.attributes['from-uuid'], 'JFK');
});

test('hideIfAge reads the birthdate, then the estimated years', () => {
  assert.equal(hidden({ yearsEstimated: 10 }, config).fieldIds.has('adultOnly'), true);
  assert.equal(hidden({ yearsEstimated: 30 }, config).fieldIds.has('adultOnly'), false);
  assert.equal(hidden({ birthdate: new Date(Date.now() - 5 * 365.25 * 864e5) }, config).fieldIds.has('adultOnly'), true);
  assert.equal(hidden({}, config).fieldIds.has('adultOnly'), false);
});

test('a condition on a hidden field sees it as empty', () => {
  const chained = {
    ...config,
    fieldDefinitions: [
      ...config.fieldDefinitions,
      { id: 'followUp', type: 'person attribute', uuid: 'follow-uuid', hideIf: { fieldId: 'referredFrom', value: '' } },
    ],
  };
  // referredFrom still holds a stale value, but its section is hidden, so followUp hides too.
  const { fieldIds } = hidden({ attributes: { 'referred-uuid': no, 'from-uuid': 'JFK' } }, chained);
  assert.equal(fieldIds.has('followUp'), true);
});
