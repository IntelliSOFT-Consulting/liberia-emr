'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { anchor, lock, patchSource, replacement } = require('./patch-form-engine-checkbox.cjs');

// Searchable branch from the same MultiSelect function. It already forwards
// validation and must stay byte-for-byte intact.
const searchable =
  'p?b().createElement(B.Qp5,{disabled:e.isDisabled,id:e.id,initialSelectedItems:y,invalid:n.length>0,invalidText:n[0]?.message,items:c,warn:S.length>0,warnText:S[0]?.message})';

function bundleFixture() {
  return (
    'let lK=({field:e,value:D,errors:n,warnings:S,setFieldValue:g})=>{' +
    'return!e.isHidden&&b().createElement(b().Fragment,null,' +
    searchable +
    ':' +
    anchor +
    ',c?.map((D,n)=>b().createElement(B.Sc0,{readOnly:(0,nI.H)(e.readonly)})))}'
  );
}

// Same expressions the patch inserts. Carbon CheckboxGroup paints invalidText
// only when invalid is true (and the group is not read-only).
function checkboxValidationProps(errors = [], warnings = []) {
  return {
    invalid: errors.length > 0,
    invalidText: errors[0]?.message,
    warn: warnings.length > 0,
    warnText: warnings[0]?.message,
  };
}

test('the checkbox branch receives the same validation props as the searchable branch', () => {
  const patched = patchSource(bundleFixture());
  assert.equal(patched.includes(replacement), true);
  assert.equal(patched.includes(anchor), false);
  assert.equal(patched.split(lock).length - 1, 1);
  assert.equal(patched.split(searchable).length - 1, 1);
  assert.match(patched, /!e\.isHidden&&/);
  assert.match(patched, /legendText:b\(\)\.createElement\(Sh,\{field:e\}\)/);
  assert.match(patched, /readOnly:\(0,nI\.H\)\(e\.readonly\)/);
});

test('empty required group shows Field is mandatory; a selection does not', () => {
  assert.deepEqual(checkboxValidationProps([{ message: 'Field is mandatory' }]), {
    invalid: true,
    invalidText: 'Field is mandatory',
    warn: false,
    warnText: undefined,
  });
  assert.deepEqual(checkboxValidationProps([]), {
    invalid: false,
    invalidText: undefined,
    warn: false,
    warnText: undefined,
  });
});

test('optional empty groups and warnings do not invent a required error', () => {
  assert.equal(checkboxValidationProps([]).invalid, false);
  assert.deepEqual(checkboxValidationProps([], [{ message: 'Check this value' }]), {
    invalid: false,
    invalidText: undefined,
    warn: true,
    warnText: 'Check this value',
  });
});

test('a second run and a drifted bundle fail closed', () => {
  const once = patchSource(bundleFixture());
  assert.throws(() => patchSource(once), /already patched/);
  assert.throws(() => patchSource('no checkbox group here'), /found 0/);
  assert.throws(() => patchSource(anchor + anchor), /found 2/);
});
