import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateAsync } from '@openmrs/esm-expression-evaluator';
import { isTdVaccine } from './td-pregnancy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const form = JSON.parse(readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
), 'utf8'));
const variables = readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/variables.properties',
), 'utf8');
const concepts = readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv',
), 'utf8');
const indexSource = readFileSync(join(root, 'packages/esm-liberia-patient-chart-extension/src/index.ts'), 'utf8');

const tdVariables = [
  'var.concept.national.td.uuid',
  'var.concept.national.td2.uuid',
  'var.concept.national.td3.uuid',
  'var.concept.national.td4.uuid',
  'var.concept.national.td5.uuid',
];

function questions() {
  return form.pages.flatMap((page: { sections: Array<{ questions?: unknown[]; hide?: { hideWhenExpression?: string } }> }) =>
    page.sections.flatMap((section) => section.questions ?? []));
}

function question(id: string) {
  const found = questions().find((item: { id?: string }) => item.id === id);
  assert.ok(found, `missing form question ${id}`);
  return found as {
    id: string;
    hide?: { hideWhenExpression?: string };
    questionOptions?: { calculate?: { calculateExpression?: string }; answers?: Array<{ concept: string; label: string; hide?: { hideWhenExpression?: string } }> };
    validators?: Array<{ failsWhenExpression: string; message: string }>;
  };
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function substitute(expression: string) {
  return expression.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const token = name.replace(/^var\.concept\./, '').replace(/\.uuid$/, '');
    return token;
  });
}

describe('Immunization form Td entry point', () => {
  const vaccine = question('vaccine_name');
  const gate = question('td_gate');
  const vaccinationSection = form.pages[0].sections.find((section: { label: string }) => section.label === 'Vaccination');

  it('versions the form from its name and version', () => {
    assert.equal(form.version, '1.7');
    assert.equal(form.uuid, '${var.form.immunization.uuid}');
    const seed = '794c4598-ab82-47ca-8d18-483a8abe6f4f_Immunization_1.7';
    const digest = createHash('md5').update(seed).digest();
    digest[6] = (digest[6] & 0x0f) | 0x30;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const derived = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    assert.match(variables, new RegExp(`^var\\.form\\.immunization\\.uuid=${derived}$`, 'm'));
  });

  it('keeps childhood vaccines available and gates only Td', () => {
    assert.equal(vaccinationSection.hide, undefined);
    const answers = vaccine.questionOptions?.answers ?? [];
    assert.deepEqual(answers.map((answer) => answer.label), [
      'BCG', 'OPV0', 'OPV1', 'Pediatric Pfizer COVID-19 dose 1', 'Pediatric Pfizer COVID-19 dose 2',
      'TD', 'TD2', 'TD3', 'TD4', 'TD5',
    ]);
    assert.equal(answers[0].hide?.hideWhenExpression, 'age >= 1');
    assert.equal(answers[1].hide?.hideWhenExpression, 'age > 18');
    assert.equal(answers[2].hide?.hideWhenExpression, 'age > 18');
    for (const answer of answers.slice(3)) {
      assert.equal(answer.hide, undefined);
    }
    assert.equal(question('parent_caregiver').hide?.hideWhenExpression, 'age > 18');
    assert.equal(question('caregiver_phone_number').hide?.hideWhenExpression, 'age > 18');
    const supplementary = form.pages[1].sections[0];
    assert.equal(supplementary.hide.hideWhenExpression, 'age > 18');
    const activity = supplementary.questions.find((item: { id?: string }) => item.id === 'supp_activities');
    assert.deepEqual(
      activity?.questionOptions?.answers?.map((answer: { label: string }) => answer.label),
      ['Vit.-A.Blue 100,000iu', 'Vit.-A.Red 200,000iu'],
    );
    assert.equal(question('return_date').validators?.[0].message, 'Return date must be a future date.');
    const notice = form.pages[0].sections.find((section: { label: string }) => section.label === 'Notice');
    assert.equal(notice.hide.hideWhenExpression, 'age < 18');
    const hidden = (expression: string, age: number) => Boolean(new Function('age', `return (${expression});`)(age));
    assert.equal(hidden(notice.hide.hideWhenExpression, 17), true);
    assert.equal(hidden(notice.hide.hideWhenExpression, 18), false);
    assert.equal(hidden('age > 18', 18), false);
    assert.equal(hidden(notice.hide.hideWhenExpression, 19), false);
    assert.equal(hidden('age > 18', 19), true);
  });

  it('offers Td answers on the vaccine-name concept', () => {
    const row = concepts.split('\n').find((line) => line.startsWith('${var.concept.national.vaccine-name.uuid},'));
    assert.ok(row);
    for (const variable of ['var.concept.national.opv0-1-dose.uuid', 'var.concept.national.opv1.uuid', 'var.concept.national.bcg.uuid', ...tdVariables]) {
      assert.ok(row?.includes(`\${${variable}}`));
    }
  });

  it('gives every question its own id', () => {
    const ids: string[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const record = node as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.type === 'string') {
        ids.push(record.id);
      }
      Object.values(record).forEach(visit);
    };
    visit(form);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, []);
    assert.equal(ids.filter((id) => id === 'tdEncounterDate').length, 1);
    assert.equal(ids.filter((id) => id === 'encounterDate').length, 1);
    assert.match(gate.questionOptions?.calculate?.calculateExpression ?? '', /tdAdministrationGate\(patient\.id, patient\.birthDate, tdEncounterDate,/);
  });

  it('registers the helper the form calls', () => {
    assert.match(indexSource, /registerFormEngineExpressionHelper\('tdAdministrationGate', tdAdministrationGate\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('isTdVaccine', isTdVaccine\)/);
  });

  it('evaluates the shipped calculate expression', async () => {
    const expression = substitute(gate.questionOptions?.calculate?.calculateExpression ?? '');
    assert.match(expression, /vitaminAEditingEncounterUuid\(\)/);
    assert.doesNotMatch(expression, /typeof|\bencounter\b/);
    const calls: unknown[][] = [];
    const tdAdministrationGate = (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve('allowed');
    };
    const evaluate = (vaccineName: string, editingEncounterUuid: string) => evaluateAsync(expression, {
      patient: { id: 'patient-1', birthDate: '1990-01-01' },
      tdEncounterDate: '2024-06-01',
      vaccine_name: vaccineName,
      vitaminAEditingEncounterUuid: () => editingEncounterUuid,
      tdAdministrationGate,
    });
    const code = await evaluate('national.td', 'encounter-1');
    assert.equal(code, 'allowed');
    assert.deepEqual(calls[0], [
      'patient-1',
      '1990-01-01',
      '2024-06-01',
      'national.td',
      'encounter-1',
      'ciel.pregnancy-status',
      'national.1st-trimester',
      'national.2nd-trimester',
      'national.3rd-trimester',
      'national.vaccine-name',
      'national.td',
      'national.date-of-tt1',
      'national.td2',
      'national.date-of-tt2',
      'national.td3',
      'national.date-of-tt3',
      'national.td4',
      'national.date-of-tt4',
      'national.td5',
      'national.date-of-tt5',
    ]);

    await evaluate('national.opv1', '');
    assert.equal(calls[1][4], '');
  });

  it('applies the shipped validators to Td and leaves other vaccines alone', () => {
    const validators = (vaccine.validators ?? []).filter((validator) => validator.failsWhenExpression.includes('isTdVaccine'));
    assert.deepEqual(validators.map((validator) => validator.message), [
      'Td cannot be given because pregnancy status or tetanus history could not be checked.',
      'Confirm the current pregnancy before giving Td. Pregnancy status is not recorded.',
      'Td cannot be given because the TT and Td dates for the same dose do not match.',
      'This Td dose is already recorded.',
      'This Td dose is not due yet. The previous tetanus dose and the required interval have not been met.',
    ]);

    const fails = (myValue: string, tdGate: string) => validators.map((validator) => {
      const expression = substitute(validator.failsWhenExpression);
      const evaluate = new Function('myValue', 'td_gate', 'isEmpty', 'isTdVaccine', `return (${expression});`);
      return evaluate(myValue, tdGate, isEmpty, isTdVaccine);
    });

    assert.deepEqual(fails('national.opv1', 'unknown-pregnancy'), [false, false, false, false, false]);
    assert.deepEqual(fails('national.bcg', ''), [false, false, false, false, false]);
    assert.deepEqual(fails('national.td', ''), [true, false, false, false, false]);
    assert.deepEqual(fails('national.td', 'unresolved'), [true, false, false, false, false]);
    assert.deepEqual(fails('national.td2', 'unknown-pregnancy'), [false, true, false, false, false]);
    assert.deepEqual(fails('national.td4', 'history-conflict'), [false, false, true, false, false]);
    assert.deepEqual(fails('national.td5', 'already-given'), [false, false, false, true, false]);
    assert.deepEqual(fails('national.td', 'too-soon'), [false, false, false, false, true]);
    assert.deepEqual(fails('national.td', 'allowed'), [false, false, false, false, false]);
  });
});
