import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MG = '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MMOL = '1458AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function loadProbe() {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--import', resolve(here, 'rbs-form-engine-register.mjs'),
    resolve(here, 'rbs-unit-selector.probe.mjs'),
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `probe exited ${result.status}`);
  }
  return JSON.parse(result.stdout) as {
    version: string;
    forms: Array<{
      name: string;
      version: string;
      authoredType: string;
      broken: {
        kind: string;
        disabled: boolean;
        isDisabled: boolean;
        textInputDisabled: boolean;
        radioCount: number;
        transient: boolean;
        concept: string | null;
      };
      fixed: {
        kind: string;
        disabled: boolean;
        isDisabled: boolean;
        transient: boolean;
        persistedConcept: string | null;
        adapterValue: unknown;
        formGroupDisabled: boolean;
        answers: Array<{ label: string; id: string }>;
        dependentOrder: string[];
        selectMg: string;
        selectMmol: string;
        afterMg: { values: Record<string, unknown>; mgHidden: boolean; mmolHidden: boolean };
        mgControl: string;
        mmolControl: string;
        mgDisabled: boolean;
        mmolDisabled: boolean;
        submit105: { obs: Array<{ concept: string; value: number; formFieldPath: string; voided: boolean }> };
        switchToMmol: {
          values: Record<string, unknown>;
          messages: Record<string, string[]>;
          payload: { obs: Array<{ concept: string; value: unknown }> };
        };
        submit58: { obs: Array<{ concept: string; value: number; formFieldPath: string; voided: boolean }> };
        switchToMg: { values: Record<string, unknown>; messages: Record<string, string[]> };
        movedFive: { values: Record<string, unknown>; obs: Array<{ concept: string; value: number; formFieldPath: string; voided: boolean }> };
        submitZero: Array<{ concept: string; value: number; formFieldPath: string; voided: boolean }>;
        submitUpper: Array<{ concept: string; value: number; formFieldPath: string; voided: boolean }>;
      };
    }>;
  };
}

const probe = loadProbe();

describe('pinned form engine initial blood sugar unit', () => {
  it('uses the form engine bundled with esm-form-engine-app 12.3.4', () => {
    assert.equal(probe.version, '4.2.2-pre.2449');
    assert.deepEqual(probe.forms.map((form) => [form.name, form.version]), [
      ['Triage Form', '2.2'],
      ['OPD Consultation Form', '2.2'],
    ]);
  });

  for (const form of probe.forms) {
    describe(form.name, () => {
      it('disables a conceptless obs radio by replacing it with a text input', () => {
        assert.equal(form.broken.kind, 'text');
        assert.equal(form.broken.disabled, true);
        assert.equal(form.broken.isDisabled, true);
        assert.equal(form.broken.textInputDisabled, true);
        assert.equal(form.broken.radioCount, 0);
        assert.equal(form.broken.concept, null);
        assert.equal(form.broken.transient, true);
      });

      it('keeps the unit selector a transient control that can be selected', () => {
        assert.equal(form.authoredType, 'control');
        assert.equal(form.fixed.kind, 'radio');
        assert.equal(form.fixed.disabled, false);
        assert.equal(form.fixed.isDisabled, false);
        assert.equal(form.fixed.formGroupDisabled, false);
        assert.equal(form.fixed.transient, true);
        assert.equal(form.fixed.persistedConcept, null);
        assert.equal(form.fixed.adapterValue, null);
        assert.deepEqual(form.fixed.answers.map((answer) => answer.label), ['mg/dL', 'mmol/L']);
        assert.equal(form.fixed.selectMg, MG);
        assert.equal(form.fixed.selectMmol, MMOL);
      });

      it('shows only the value field for the selected unit', () => {
        assert.deepEqual(form.fixed.dependentOrder, ['rbsMgdl', 'rbsMmol']);
        assert.equal(form.fixed.afterMg.mgHidden, false);
        assert.equal(form.fixed.afterMg.mmolHidden, true);
        assert.equal(form.fixed.mgControl, 'number');
        assert.equal(form.fixed.mmolControl, 'number');
        assert.equal(form.fixed.mgDisabled, false);
        assert.equal(form.fixed.mmolDisabled, false);
        assert.equal(form.fixed.afterMg.values.rbsUnit, MG);
      });

      it('submits only the chosen glucose observation', () => {
        assert.deepEqual(form.fixed.submit105.obs, [{
          concept: MG,
          value: 105,
          formFieldPath: 'rfe-forms-rbsMgdl',
          voided: false,
        }]);
        assert.deepEqual(form.fixed.submit58.obs, [{
          concept: MMOL,
          value: 5.8,
          formFieldPath: 'rfe-forms-rbsMmol',
          voided: false,
        }]);
        assert.deepEqual(form.fixed.submitZero, [{
          concept: MG,
          value: 0,
          formFieldPath: 'rfe-forms-rbsMgdl',
          voided: false,
        }]);
        assert.deepEqual(form.fixed.submitUpper, [{
          concept: MMOL,
          value: 33.3,
          formFieldPath: 'rfe-forms-rbsMmol',
          voided: false,
        }]);
      });

      it('moves the number to the newly selected unit and rejects it when the range no longer fits', () => {
        assert.equal(form.fixed.switchToMmol.values.rbsMgdl, '');
        assert.equal(form.fixed.switchToMmol.values.rbsMmol, 105);
        assert.deepEqual(form.fixed.switchToMmol.messages.rbsMmol, [
          'Initial blood sugar must be between 0 and 33.3 mmol/L.',
        ]);
        assert.deepEqual(form.fixed.switchToMmol.payload.obs, []);
        assert.equal(form.fixed.switchToMg.values.rbsMmol, '');
        assert.equal(form.fixed.switchToMg.values.rbsMgdl, 5.8);
        assert.deepEqual(form.fixed.switchToMg.messages.rbsMgdl, [
          'Initial blood sugar in mg/dL must be a whole number.',
        ]);
        assert.equal(form.fixed.movedFive.values.rbsMgdl, '');
        assert.equal(form.fixed.movedFive.values.rbsMmol, 5);
        assert.deepEqual(form.fixed.movedFive.obs, [{
          concept: MMOL,
          value: 5,
          formFieldPath: 'rfe-forms-rbsMmol',
          voided: false,
        }]);
      });
    });
  }
});
