import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FieldValidator } = require('@openmrs/esm-form-engine-lib/dist/validators/form-validator.js');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const formPath = resolve(
  repoRoot,
  'content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/third_stage_of_labor_and_delivery-mch.json',
);
const controlsPath = require.resolve(
  '@openmrs/esm-form-engine-lib/src/registry/inbuilt-components/inbuiltControls.ts',
);

type Question = {
  id: string;
  required?: unknown;
  datePickerFormat?: string;
  questionOptions: { rendering: string; datePickerFormat?: string };
  questions?: Array<Question>;
};

const form = JSON.parse(readFileSync(formPath, 'utf8'));
const questions = new Map<string, Question>();
function collect(list: Array<Question>) {
  for (const q of list) {
    questions.set(q.id, q);
    if (q.questions) collect(q.questions);
  }
}
for (const page of form.pages) {
  for (const section of page.sections) {
    collect(section.questions);
  }
}

const controls = readFileSync(controlsPath, 'utf8');
const registeredControls = new Set([...controls.matchAll(/name: '([^']+)'/g)].map((match) => match[1]));

const timeFields = ['medication_time', 'placenta_delivery_time', 'time_at_which_baby_delivered'];

describe('Third Stage time fields against the pinned form-engine-lib registry', () => {
  it('versions the form for the time control change', () => {
    assert.equal(form.name, '3. Third Stage of Labor and Delivery');
    assert.equal(form.version, '1.2');
  });

  // An unregistered rendering never mounts, so its required error blocks submit
  // and reddens the section with no visible message.
  it('uses only renderings the engine registers', () => {
    assert.ok(!registeredControls.has('time'));
    for (const [id, q] of questions) {
      assert.ok(registeredControls.has(q.questionOptions.rendering), `${id}: ${q.questionOptions.rendering}`);
    }
  });

  it('renders every time question with the timer picker', () => {
    for (const id of timeFields) {
      const q = questions.get(id);
      assert.ok(q, `missing question ${id}`);
      assert.equal(q.questionOptions.rendering, 'date', id);
      assert.equal(q.datePickerFormat, 'timer', id);
      assert.equal(q.questionOptions.datePickerFormat, undefined, id);
    }
  });

  it('reports a visible message for an empty required time', () => {
    const q = questions.get('time_at_which_baby_delivered');
    const errors = FieldValidator.validate(
      { id: q.id, isRequired: true, questionOptions: q.questionOptions, datePickerFormat: q.datePickerFormat, meta: {} },
      undefined,
    );
    assert.equal(errors[0]?.message, 'Field is mandatory');
  });
});
