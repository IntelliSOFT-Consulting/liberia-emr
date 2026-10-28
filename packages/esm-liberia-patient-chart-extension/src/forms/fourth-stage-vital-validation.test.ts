import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FieldValidator, isEmpty } = require('@openmrs/esm-form-engine-lib/dist/validators/form-validator.js');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const formPath = resolve(
  repoRoot,
  'content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/fourth_stage_monitoring_for_woman_and_baby-mch.json',
);
const controlsPath = require.resolve(
  '@openmrs/esm-form-engine-lib/src/registry/inbuilt-components/inbuiltControls.ts',
);

type Question = {
  id: string;
  required?: boolean;
  datePickerFormat?: string;
  questionOptions: {
    rendering: string;
    min?: number;
    max?: number;
    disallowDecimals?: boolean;
  };
  validators?: Array<{ type: string; failsWhenExpression?: string; message?: string }>;
};

const form = JSON.parse(readFileSync(formPath, 'utf8'));
const questions = new Map<string, Question>();
for (const page of form.pages) {
  for (const section of page.sections) {
    for (const question of section.questions) {
      questions.set(question.id, question);
    }
  }
}

function question(id: string): Question {
  const found = questions.get(id);
  assert.ok(found, `missing question ${id}`);
  return found;
}

// The expression runner binds isEmpty to this same helper. These rules only
// reference isEmpty and myValue, so evaluating them here is the expression the
// pinned engine runs.
function expressionFails(expression: string, myValue: number): boolean {
  return Function('myValue', 'isEmpty', `return (${expression});`)(myValue, isEmpty) === true;
}

function engineErrors(vital: Question, value: number) {
  const validators = [...(vital.validators ?? [])];
  if (!validators.some((validator) => validator.type === 'form_field')) {
    validators.push({ type: 'form_field' });
  }
  const field = {
    id: vital.id,
    isRequired: Boolean(vital.required),
    questionOptions: vital.questionOptions,
    meta: { concept: { allowDecimal: false } },
  };
  const errors: Array<{ message?: string; errCode?: string }> = [];
  for (const validator of validators) {
    if (validator.type === 'js_expression' && validator.failsWhenExpression) {
      if (expressionFails(validator.failsWhenExpression, value)) {
        errors.push({ errCode: 'value.invalid', message: validator.message });
      }
    }
    if (validator.type === 'form_field') {
      errors.push(...FieldValidator.validate(field, value));
    }
  }
  return errors;
}

function assertAllowed(id: string, value: number) {
  const errors = engineErrors(question(id), value);
  assert.deepEqual(errors, [], `${id}=${value} should be accepted, got ${JSON.stringify(errors)}`);
}

function assertRejected(id: string, value: number) {
  const vital = question(id);
  const errors = engineErrors(vital, value);
  assert.ok(errors.length > 0, `${id}=${value} should be rejected`);
  assert.equal(errors[0]?.message, vital.validators?.[0]?.message, `${id}=${value} displayed message`);
  assert.match(errors[0]?.message ?? '', /outside the permitted range/);
  assert.equal(errors[0]?.errCode, 'value.invalid');
}

describe('Fourth Stage vital validation against form-engine-lib 4.2.1 FieldValidator', () => {
  it('keeps the released v1.4 identity', () => {
    assert.equal(form.version, '1.4');
    assert.equal(form.name, '4. Fourth Stage Monitoring for Woman and Baby');
    assert.equal(form.uuid, '${var.form.fourth-stage-monitoring-for-woman-and-baby.uuid}');
  });

  it('uses CIEL absolute ranges and rejects decimals in the configured message', () => {
    const systolic = question('bp_sys');
    const diastolic = question('bp_dia');
    const pulse = question('pulse');
    assert.deepEqual(
      [systolic.questionOptions.min, systolic.questionOptions.max, systolic.questionOptions.disallowDecimals],
      [0, 250, true],
    );
    assert.deepEqual(
      [diastolic.questionOptions.min, diastolic.questionOptions.max, diastolic.questionOptions.disallowDecimals],
      [0, 150, true],
    );
    assert.deepEqual(
      [pulse.questionOptions.min, pulse.questionOptions.max, pulse.questionOptions.disallowDecimals],
      [0, 250, true],
    );
    for (const vital of [systolic, diastolic, pulse]) {
      assert.equal(vital.validators?.[0]?.type, 'js_expression');
      assert.match(vital.validators?.[0]?.failsWhenExpression ?? '', /% 1 !== 0/);
    }
  });

  it('accepts systolic boundaries and the QA value, and rejects neighbours and decimals', () => {
    assertAllowed('bp_sys', 0);
    assertAllowed('bp_sys', 250);
    assertAllowed('bp_sys', 248);
    assertRejected('bp_sys', 251);
    assertRejected('bp_sys', -1);
    assertRejected('bp_sys', 248.5);
  });

  it('accepts diastolic 0 and 150 and the QA value, and rejects 151, -1 and a decimal', () => {
    assertAllowed('bp_dia', 0);
    assertAllowed('bp_dia', 150);
    assertAllowed('bp_dia', 144);
    assertRejected('bp_dia', 151);
    assertRejected('bp_dia', -1);
    assertRejected('bp_dia', 144.2);
  });

  it('accepts pulse 0, 250 and 76, and rejects one below, one above and a decimal', () => {
    assertAllowed('pulse', 0);
    assertAllowed('pulse', 19);
    assertAllowed('pulse', 250);
    assertAllowed('pulse', 76);
    assertRejected('pulse', -1);
    assertRejected('pulse', 251);
    assertRejected('pulse', 76.5);
  });

  it('shows the configured message ahead of the inbuilt range message', () => {
    const errors = engineErrors(question('bp_sys'), 251);
    assert.equal(
      errors[0]?.message,
      'Systolic Blood Pressure is outside the permitted range. Enter a whole number from 0 to 250 mmHg.',
    );
    assert.equal(errors[1]?.message, 'Value must be lower than 250');
  });

  it('renders Observation time with the timer control the pinned engine actually has', () => {
    const observationTime = question('observation_time');
    assert.equal(observationTime.required, true);
    assert.equal(observationTime.questionOptions.rendering, 'date');
    assert.equal(observationTime.datePickerFormat, 'timer');
    assert.equal(observationTime.questionOptions.datePickerFormat, undefined);
    const controls = readFileSync(controlsPath, 'utf8');
    assert.match(controls, /name: 'date'/);
    assert.match(controls, /name: 'datetime'/);
    assert.doesNotMatch(controls, /name: 'time'/);
    const empty = FieldValidator.validate(
      {
        id: 'observation_time',
        isRequired: true,
        questionOptions: observationTime.questionOptions,
        meta: {},
      },
      undefined,
    );
    assert.equal(empty[0]?.message, 'Field is mandatory');
  });
});
