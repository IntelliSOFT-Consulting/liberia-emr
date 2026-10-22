import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keepHistoryEncounter } from './keep-history-encounter.ts';
import { columnConceptUuids, formatHistoryCell, type HistoryColumn, type HistoryObs } from './history-value.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MG = '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MMOL = '1458AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FASTING = '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRIAGE_V21 = '895df6cc-b485-33e0-8512-dffbede0efac';
const TRIAGE_V22 = '6de467ca-4020-3078-8a3c-6c098c8c22b5';
const OPD_V21 = '3500013a-097e-3cee-ae7d-943b9bc48dee';
const OPD_V22 = 'afab184a-bd44-3352-9a83-6f53e44acff5';

interface FormQuestion {
  id?: string;
  label?: string;
  type?: string;
  required?: boolean;
  hide?: { hideWhenExpression?: string };
  questionOptions?: {
    rendering?: string;
    concept?: string;
    min?: string;
    max?: string;
    step?: number;
    disallowDecimals?: boolean;
    isTransient?: boolean;
    answers?: Array<{ label?: string; concept?: string }>;
    calculate?: { calculateExpression?: string };
  };
  validators?: Array<{ failsWhenExpression?: string; message?: string }>;
  questions?: FormQuestion[];
}

function javaUuid(seed: string): string {
  const digest = createHash('md5').update(seed, 'utf8').digest();
  const bytes = Buffer.from(digest);
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function variables(): Map<string, string> {
  const declared = new Map<string, string>();
  const packages = join(root, 'content-packages');
  for (const pkg of readdirSync(packages)) {
    const path = join(packages, pkg, 'configuration', 'variables.properties');
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const [key, value] = trimmed.split('=', 2);
      declared.set(key.trim(), value.trim());
    }
  }
  return declared;
}

function substitute(text: string, vars: Map<string, string>): string {
  return text.replace(/\$\{([^}]+)\}/g, (token, name: string) => vars.get(name) ?? token);
}

function loadForm(file: string): { name: string; version: string; questions: FormQuestion[] } {
  const schema = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
    name: string;
    version: string;
    pages: Array<{ sections: Array<{ label: string; questions: FormQuestion[] }> }>;
  };
  const questions: FormQuestion[] = [];
  for (const page of schema.pages) {
    for (const section of page.sections ?? []) {
      if (section.label === 'Vital Signs' || section.label === 'Vitals') {
        questions.push(...(section.questions ?? []));
      }
    }
  }
  return { name: schema.name, version: schema.version, questions };
}

function question(form: { questions: FormQuestion[] }, id: string): FormQuestion {
  const found = form.questions.find((item) => item.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (typeof value === 'string' && value.trim() === '');
}

function fails(expression: string | undefined, myValue: unknown): boolean {
  assert.ok(expression, 'missing validator expression');
  const result = new Function('isEmpty', 'myValue', `return (${expression});`)(isEmpty, myValue);
  return Boolean(result);
}

function calculate(expression: string, field: 'rbsUnit' | 'rbsMgdl' | 'rbsMmol', values: Record<string, unknown>): unknown {
  return new Function('isEmpty', 'myValue', 'rbsUnit', 'rbsMgdl', 'rbsMmol', `return (${expression});`)(
    isEmpty,
    values[field],
    values.rbsUnit,
    values.rbsMgdl,
    values.rbsMmol,
  );
}

function obs(concept: string, value: number | string): HistoryObs {
  return { uuid: `${concept}-${value}`, concept: { uuid: concept, display: concept }, value, display: String(value) };
}

const rbsColumn: HistoryColumn = {
  label: 'Initial blood sugar / RBS',
  concept: MG,
  concepts: [
    { concept: MG, unit: 'mg/dL' },
    { concept: MMOL, unit: 'mmol/L' },
  ],
};

describe('random blood sugar capture contract', () => {
  const vars = variables();
  const forms = [
    loadForm('content-packages/content-liberia-opd-ipd/configuration/backend_configuration/ampathforms/triage_form.json'),
    loadForm('content-packages/content-liberia-opd-ipd/configuration/backend_configuration/ampathforms/opd_consultation_form.json'),
  ].map((form) => ({
    ...form,
    questions: JSON.parse(substitute(JSON.stringify(form.questions), vars)) as FormQuestion[],
  }));

  for (const form of forms) {
    describe(form.name, () => {
      const unit = question(form, 'rbsUnit');
      const mg = question(form, 'rbsMgdl');
      const mmol = question(form, 'rbsMmol');
      const mgRange = mg.validators?.find((item) => item.message?.includes('0 and 600'));
      const mgWhole = mg.validators?.find((item) => item.message?.includes('whole number'));
      const mmolRange = mmol.validators?.find((item) => item.message?.includes('0 and 33.3'));

      it('adds an optional initial blood sugar field to the vitals section', () => {
        assert.equal(unit.label, 'Initial blood sugar unit');
        assert.equal(mg.label, 'Initial blood sugar / RBS');
        assert.equal(mmol.label, 'Initial blood sugar / RBS');
        assert.notEqual(unit.required, true);
        assert.notEqual(mg.required, true);
        assert.notEqual(mmol.required, true);
      });

      it('offers mg/dL and mmol/L and does not use fasting glucose', () => {
        assert.equal(unit.questionOptions?.isTransient, true);
        assert.deepEqual(
          unit.questionOptions?.answers?.map((answer) => answer.label),
          ['mg/dL', 'mmol/L'],
        );
        assert.equal(unit.questionOptions?.answers?.[0]?.concept, MG);
        assert.equal(unit.questionOptions?.answers?.[1]?.concept, MMOL);
        assert.equal(mg.questionOptions?.concept, MG);
        assert.equal(mmol.questionOptions?.concept, MMOL);
        assert.equal(JSON.stringify(form.questions).includes(FASTING), false);
      });

      it('persists the selected unit on the matching CIEL concept', () => {
        assert.equal(mg.questionOptions?.disallowDecimals, true);
        assert.equal(mg.questionOptions?.min, '0');
        assert.equal(mg.questionOptions?.max, '600');
        assert.equal(mmol.questionOptions?.disallowDecimals, undefined);
        assert.equal(mmol.questionOptions?.min, '0');
        assert.equal(mmol.questionOptions?.max, '33.3');
        assert.equal(mmol.questionOptions?.step, 0.1);
      });

      it('accepts the approved boundaries and rejects values outside them', () => {
        for (const value of ['', undefined, 0, 600]) {
          assert.equal(fails(mgRange?.failsWhenExpression, value), false, `mg ${value}`);
          assert.equal(fails(mgWhole?.failsWhenExpression, value), false, `mg whole ${value}`);
        }
        assert.equal(fails(mgRange?.failsWhenExpression, 600.1), true);
        assert.equal(fails(mgWhole?.failsWhenExpression, 600.1), true);
        assert.equal(fails(mgRange?.failsWhenExpression, -1), true);
        for (const value of ['', undefined, 0, 33.3]) {
          assert.equal(fails(mmolRange?.failsWhenExpression, value), false, `mmol ${value}`);
        }
        assert.equal(fails(mmolRange?.failsWhenExpression, 33.4), true);
        assert.equal(fails(mmolRange?.failsWhenExpression, -0.1), true);
      });

      it('revalidates the same number under the unit that is selected now', () => {
        const mgCalc = mg.questionOptions?.calculate?.calculateExpression;
        const mmolCalc = mmol.questionOptions?.calculate?.calculateExpression;
        assert.ok(mgCalc && mmolCalc);
        const entered = { rbsUnit: MMOL, rbsMgdl: 100, rbsMmol: '' };
        assert.equal(calculate(mgCalc, 'rbsMgdl', entered), '');
        assert.equal(calculate(mmolCalc, 'rbsMmol', entered), 100);
        assert.equal(fails(mgRange?.failsWhenExpression, 100), false);
        assert.equal(fails(mmolRange?.failsWhenExpression, 100), true);

        const back = { rbsUnit: MG, rbsMgdl: '', rbsMmol: 5.8 };
        assert.equal(calculate(mmolCalc, 'rbsMmol', back), '');
        assert.equal(calculate(mgCalc, 'rbsMgdl', back), 5.8);
        assert.equal(fails(mmolRange?.failsWhenExpression, 5.8), false);
        assert.equal(fails(mgWhole?.failsWhenExpression, 5.8), true);
      });

      it('keeps the existing vitals concepts', () => {
        const temperature = form.questions.find((item) => item.label?.startsWith('Temperature'));
        const pulse = form.questions.find((item) => item.id === 'hr' || item.id === 'pulse');
        assert.ok(temperature?.questionOptions?.concept?.includes('5088'));
        assert.ok(pulse);
        assert.equal(pulse.questionOptions?.concept?.includes('5087'), true);
        if (form.name === 'Triage Form') {
          assert.equal(temperature?.required, true);
          assert.equal(question(form, 'pain_score').required, true);
        }
      });
    });
  }

  it('uses the same clinical concepts on Triage and OPD', () => {
    const [triage, opd] = forms;
    for (const id of ['rbsUnit', 'rbsMgdl', 'rbsMmol']) {
      assert.equal(question(triage, id).questionOptions?.concept, question(opd, id).questionOptions?.concept);
      assert.deepEqual(
        question(triage, id).validators?.map((item) => item.failsWhenExpression),
        question(opd, id).validators?.map((item) => item.failsWhenExpression),
      );
    }
  });

  it('bumps both forms to 2.2 and freezes 2.1', () => {
    const namespace = '794c4598-ab82-47ca-8d18-483a8abe6f4f';
    assert.equal(forms[0].version, '2.2');
    assert.equal(forms[1].version, '2.2');
    assert.equal(javaUuid(`${namespace}_Triage Form_2.2`), TRIAGE_V22);
    assert.equal(javaUuid(`${namespace}_OPD Consultation Form_2.2`), OPD_V22);
    assert.equal(javaUuid(`${namespace}_Triage Form_2.1`), TRIAGE_V21);
    assert.equal(javaUuid(`${namespace}_OPD Consultation Form_2.1`), OPD_V21);
    assert.equal(vars.get('var.form.triage.uuid'), TRIAGE_V22);
    assert.equal(vars.get('var.form.triage-form.v2-1.uuid'), TRIAGE_V21);
    assert.equal(vars.get('var.form.opd-consultation.uuid'), OPD_V22);
    assert.equal(vars.get('var.form.opd-consultation-form.v2-1.uuid'), OPD_V21);
  });
});

describe('random blood sugar history', () => {
  it('shows a Triage mg/dL result with the unit that was entered', () => {
    assert.equal(formatHistoryCell([obs(MG, 105)], rbsColumn), '105 mg/dL');
    assert.equal(formatHistoryCell([obs(MG, '105.0')], rbsColumn), '105 mg/dL');
  });

  it('shows an OPD mmol/L result with the unit that was entered', () => {
    assert.equal(formatHistoryCell([obs(MMOL, 5.8)], rbsColumn), '5.8 mmol/L');
    assert.equal(formatHistoryCell([obs(MMOL, 0)], rbsColumn), '0 mmol/L');
    assert.equal(formatHistoryCell([obs(MMOL, 33.3)], rbsColumn), '33.3 mmol/L');
  });

  it('does not infer the unit from the number or show both units for one observation', () => {
    assert.equal(formatHistoryCell([obs(MG, 5.8)], rbsColumn), '5.8 mg/dL');
    assert.equal(formatHistoryCell([obs(MMOL, 105)], rbsColumn), '105 mmol/L');
    const shown = formatHistoryCell([obs(MG, 105)], rbsColumn);
    assert.equal(shown.includes('mmol/L'), false);
    assert.equal(shown.toLowerCase().includes('fasting'), false);
    assert.equal(columnConceptUuids(rbsColumn).includes(FASTING), false);
  });

  it('keeps Triage and both OPD form versions, and drops other consultation forms', () => {
    const forms = [TRIAGE_V22, TRIAGE_V21, OPD_V22, OPD_V21];
    const triageType = 'd66e9fe0-7d51-4ff9-b1e0-1b4b41ba2c72';
    assert.equal(keepHistoryEncounter({ form: { uuid: TRIAGE_V22 }, encounterType: { uuid: triageType } }, forms, [triageType]), true);
    assert.equal(keepHistoryEncounter({ form: { uuid: OPD_V22 }, encounterType: { uuid: 'consultation' } }, forms, [triageType]), true);
    assert.equal(keepHistoryEncounter({ form: { uuid: OPD_V21 }, encounterType: { uuid: 'consultation' } }, forms, [triageType]), true);
    assert.equal(keepHistoryEncounter({ encounterType: { uuid: triageType } }, forms, [triageType]), true);
    assert.equal(keepHistoryEncounter({ form: { uuid: 'anc-form' }, encounterType: { uuid: 'consultation' } }, forms, [triageType]), false);
  });

  it('still renders an existing single-concept column', () => {
    const cough: HistoryColumn = { concept: 'cough', label: 'Cough > 2 wks' };
    const coded: HistoryObs = {
      uuid: 'cough-obs',
      concept: { uuid: 'cough', display: 'Cough' },
      value: { uuid: 'yes', display: 'Yes' },
      display: 'Yes',
    };
    assert.equal(formatHistoryCell([coded], cough), 'Yes');
    assert.deepEqual(columnConceptUuids(cough), ['cough']);
  });
});

describe('glucose reporting stays distinct from random blood sugar', () => {
  const lab = readFileSync(
    join(root, 'modules/mambaetl/api/src/main/mamba/_etl/derived/malaria/sp_mamba_fact_malaria_lab_result.sql'),
    'utf8',
  );
  const nutrition = readFileSync(
    join(root, 'modules/mambaetl/api/src/main/mamba/_etl/derived/nutrition/sp_mamba_fact_nutrition_anthropometry.sql'),
    'utf8',
  );

  it('keeps fasting, serum mg/dL, and serum mmol/L as separate lab codes', () => {
    assert.match(lab, /WHEN f\.result_concept_id = @lr_fbg THEN 'glucose_fasting'/);
    assert.match(lab, /WHEN f\.result_concept_id = @lr_glu THEN 'glucose_serum'/);
    assert.match(lab, /WHEN f\.result_concept_id = @lr_glu_mmol THEN 'glucose_mmol'/);
    assert.match(lab, /\$\{var\.concept\.ciel\.160912\.uuid\}/);
    assert.match(lab, /\$\{var\.concept\.ciel\.887\.uuid\}/);
    assert.match(lab, /\$\{var\.concept\.ciel\.1458\.uuid\}/);
  });

  it('still counts OPD anthropometry from the frozen form and the current form', () => {
    assert.match(nutrition, /\$\{var\.form\.opd-consultation\.uuid\}/);
    assert.match(nutrition, /\$\{var\.form\.opd-consultation-form\.v2-1\.uuid\}/);
  });
});
