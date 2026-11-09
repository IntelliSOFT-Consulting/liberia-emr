import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

  // A bump is a new form UUID; encounters on older versions must stay in the delivery fact.
  it('freezes the 1.0 and 1.1 identities and keeps them in the delivery ETL', () => {
    const vars = readFileSync(resolve(repoRoot, 'content-packages/content-liberia-mch/configuration/variables.properties'), 'utf8');
    const sql = readFileSync(
      resolve(repoRoot, 'modules/mambaetl/api/src/main/mamba/_etl/derived/rmncah/sp_mamba_fact_rmncah_delivery.sql'),
      'utf8',
    );
    const derived = (version: string) => {
      const b = createHash('md5').update(`794c4598-ab82-47ca-8d18-483a8abe6f4f_${form.name}_${version}`).digest();
      b[6] = (b[6] & 0x0f) | 0x30;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const declared = (key: string) => vars.match(new RegExp(`^${key.replace(/\./g, '\\.')}=(.+)$`, 'm'))?.[1];
    assert.equal(declared('var.form.third-stage-of-labor-and-delivery.uuid'), derived(form.version));
    for (const v of ['1-0', '1-1']) {
      const key = `var.form.3-third-stage-of-labor-and-delivery.v${v}.uuid`;
      assert.equal(declared(key), derived(v.replace('-', '.')), key);
      assert.ok(sql.includes(`'\${${key}}'`), `delivery ETL lists ${key}`);
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
