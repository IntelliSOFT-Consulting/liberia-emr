import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateAsync, extractVariableNames } from '@openmrs/esm-expression-evaluator';
import {
  vitaminABlock,
  vitaminARouteRejected,
  vitaminARouteValue,
  vitaminASharedReturnValue,
} from '../forms/vitamin-a-supplementation.ts';
import { isPediatricPfizerDose } from './pediatric-pfizer.ts';
import { sameSubmissionVaccineDuplicate } from './same-submission-vaccine.ts';
import { decideTdGate, isTdVaccine, tdConceptsFromFormArgs, type TdGateCode } from './td-pregnancy.ts';

/**
 * The expression shipped before LE-604. jsep parses `typeof` as an identifier,
 * and the evaluator evaluates both sides of `&&`, so `encounter.uuid` throws
 * whenever `encounter` is absent from the form-engine context.
 */
const brokenEncounterUuid =
  "(typeof encounter !== 'undefined' && encounter && encounter.uuid) ? encounter.uuid : ''";

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const indexSource = readFileSync(join(root, 'packages/esm-liberia-patient-chart-extension/src/index.ts'), 'utf8');
const form = JSON.parse(readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
), 'utf8'));

const BLUE = 'national.vit-a-blue-100-000iu';
const RED = 'national.vit-a-red-200-000iu';
const ORAL = 'ciel.oral';
const EDITING_ENCOUNTER = 'encounter-being-edited';

function questions() {
  const flat: Array<{ id?: string; questions?: unknown[] }> = [];
  const visit = (items: Array<{ id?: string; questions?: unknown[] }> | undefined) => {
    for (const item of items ?? []) {
      flat.push(item);
      if (Array.isArray(item.questions)) visit(item.questions as Array<{ id?: string; questions?: unknown[] }>);
    }
  };
  for (const page of form.pages) {
    for (const section of page.sections) visit(section.questions);
  }
  return flat;
}

function question(id: string) {
  const found = questions().find((item: { id?: string }) => item.id === id);
  assert.ok(found, `missing form question ${id}`);
  return found as {
    questionOptions?: { calculate?: { calculateExpression?: string } };
    validators?: Array<{ failsWhenExpression: string }>;
  };
}

/** Iniz replaces ${var.*} before the form engine evaluates the expression. */
function substitute(expression: string) {
  return expression.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const token = name.replace(/^var\.concept\./, '').replace(/\.uuid$/, '');
    return token;
  });
}

function calculate(id: string) {
  const expression = question(id).questionOptions?.calculate?.calculateExpression ?? '';
  assert.ok(expression, `${id} has no calculateExpression`);
  return substitute(expression);
}

const gateCalls: unknown[][] = [];

function tdAdministrationGate(
  patientId: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  pregnancyStatusConceptUuid: string,
  firstTrimesterUuid: string,
  secondTrimesterUuid: string,
  thirdTrimesterUuid: string,
  vaccineNameConceptUuid: string,
  td1: string,
  tt1: string,
  td2: string,
  tt2: string,
  td3: string,
  tt3: string,
  td4: string,
  tt4: string,
  td5: string,
  tt5: string,
): Promise<TdGateCode> {
  gateCalls.push([
    patientId,
    birthDate,
    evaluationDate,
    vaccineConceptUuid,
    editingEncounterUuid,
  ]);
  return Promise.resolve(decideTdGate({
    patientId,
    birthDate,
    evaluationDate,
    vaccineConceptUuid,
    editingEncounterUuid,
    concepts: tdConceptsFromFormArgs(
      pregnancyStatusConceptUuid,
      firstTrimesterUuid,
      secondTrimesterUuid,
      thirdTrimesterUuid,
      vaccineNameConceptUuid,
      td1,
      tt1,
      td2,
      tt2,
      td3,
      tt3,
      td4,
      tt4,
      td5,
      tt5,
    ),
    encounters: [],
    episodeConfig: { deliveryEncounterTypeUuid: 'delivery-type' },
    historyComplete: true,
  }));
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function runtime(values: Record<string, unknown>) {
  return {
    patient: { id: 'patient-1', birthDate: '1990-01-01' },
    tdEncounterDate: '2024-06-01',
    vaccine_name: '',
    supp_activities: '',
    vitamin_a_date_received: '',
    myValue: '',
    today: () => '2024-06-01',
    isEmpty,
    isTdVaccine,
    isPediatricPfizerDose,
    tdAdministrationGate,
    vitaminAEditingEncounterUuid: () => EDITING_ENCOUNTER,
    vitaminARouteValue,
    vitaminASharedReturnValue,
    vitaminARouteRejected,
    vitaminABlock,
    loadVitaminAAdministrations: async () => 'error',
    sameSubmissionVaccineDuplicate,
    allFieldValues: { vaccine_name: values.vaccine_name ?? '' },
    allFields: [
      { id: 'vaccine_administration', meta: {} },
      { id: 'vaccine_name', meta: { groupId: 'vaccine_administration' } },
    ],
    ...values,
  };
}

async function selectVaccine(vaccineName: string) {
  const values = runtime({ vaccine_name: vaccineName });
  const gate = await evaluateAsync(calculate('td_gate'), values);
  const route = await evaluateAsync(calculate('route'), { ...values, myValue: '' });
  const currentReturn = new Date(2024, 5, 1, 12, 0, 0, 0);
  const returnDate = await evaluateAsync(calculate('return_date'), { ...values, myValue: currentReturn });
  const validatorResults = (question('vaccine_name').validators ?? []).map((validator) =>
    evaluateAsync(substitute(validator.failsWhenExpression), { ...values, myValue: vaccineName, td_gate: gate }));
  await Promise.all(validatorResults);
  return { gate, route, returnDate, currentReturn };
}

describe('LE-604 vaccine selection calculate expressions', () => {
  it('rejects the pre-fix encounter guard with ReferenceError: encounter is not defined', async () => {
    const shipped = calculate('td_gate');
    assert.equal(form.version, '1.9');
    assert.match(shipped, /vitaminAEditingEncounterUuid\(\)/);
    assert.doesNotMatch(shipped, /typeof encounter|encounter\.uuid/);
    await assert.rejects(
      () => evaluateAsync(brokenEncounterUuid, { encounter: undefined }),
      (error: unknown) => {
        assert.ok(error instanceof ReferenceError);
        assert.match((error as Error).message, /encounter is not defined/);
        return true;
      },
    );
    let called = false;
    const fullBroken = shipped.replace(
      'vitaminAEditingEncounterUuid()',
      brokenEncounterUuid,
    );
    await assert.rejects(
      () => evaluateAsync(fullBroken, {
        ...runtime({ vaccine_name: 'national.bcg' }),
        tdAdministrationGate: () => {
          called = true;
          return Promise.resolve('allowed');
        },
      }),
      (error: unknown) => error instanceof ReferenceError,
    );
    assert.equal(called, false);
  });

  it('reevaluates the vaccine-name calculate dependents and leaves history alone', () => {
    const dependents = ['td_gate', 'route', 'return_date'];
    for (const id of dependents) {
      assert.ok(extractVariableNames(calculate(id)).includes('vaccine_name'), id);
    }
    assert.equal(extractVariableNames(calculate('vitamin_a_history')).includes('vaccine_name'), false);
    assert.equal(extractVariableNames(calculate('td_gate')).includes('supp_activities'), false);
  });

  it('registers each immunization helper once', () => {
    for (const name of [
      'tdAdministrationGate',
      'isTdVaccine',
      'vitaminACurrentStrength',
      'vitaminABlock',
      'vitaminAReturnDateValue',
      'vitaminASharedReturnValue',
      'vitaminARouteValue',
      'vitaminARouteRejected',
      'vitaminAEditingEncounterUuid',
      'loadVitaminAAdministrations',
    ]) {
      const matches = indexSource.match(new RegExp(`registerFormEngineExpressionHelper\\('${name}'`, 'g')) ?? [];
      assert.equal(matches.length, 1, name);
    }
  });

  it('selecting BCG, OPV0, or OPV1 does not throw and does not open the Td gate', async () => {
    for (const vaccine of ['national.bcg', 'national.opv0-1-dose', 'national.opv1']) {
      gateCalls.length = 0;
      const selected = await selectVaccine(vaccine);
      assert.equal(selected.gate, 'allowed');
      assert.equal(selected.route, '');
      assert.equal(selected.returnDate, selected.currentReturn);
      assert.equal(gateCalls.at(-1)?.[3], vaccine);
      assert.equal(gateCalls.at(-1)?.[4], EDITING_ENCOUNTER);
      const routeRejected = await evaluateAsync(
        substitute(question('route').validators?.[0].failsWhenExpression ?? ''),
        { ...runtime({ vaccine_name: vaccine }), myValue: '' },
      );
      assert.equal(routeRejected, false);
    }
  });

  it('selecting TD does not throw and still blocks an unconfirmed pregnancy', async () => {
    gateCalls.length = 0;
    const selected = await selectVaccine('national.td');
    assert.equal(selected.gate, 'unknown-pregnancy');
    assert.equal(selected.route, '');
    assert.equal(gateCalls.at(-1)?.[3], 'national.td');
    assert.equal(gateCalls.at(-1)?.[4], EDITING_ENCOUNTER);
  });

  it('selecting Vitamin A does not throw and still calculates the oral route and return date', async () => {
    const birth = '2019-01-15';
    const given = '2023-06-15';
    const values = runtime({
      patient: { id: 'patient-1', birthDate: birth },
      vaccine_name: '',
      supp_activities: RED,
      vitamin_a_date_received: given,
      today: () => given,
    });
    const gate = await evaluateAsync(calculate('td_gate'), values);
    const route = await evaluateAsync(calculate('route'), { ...values, myValue: '' });
    const returnDate = await evaluateAsync(calculate('return_date'), {
      ...values,
      myValue: new Date(2023, 10, 1, 12, 0, 0, 0),
    });
    const routeRejected = await evaluateAsync(
      substitute(question('route').validators?.[0].failsWhenExpression ?? ''),
      { ...values, myValue: 'intradermal' },
    );
    assert.equal(gate, 'allowed');
    assert.equal(route, ORAL);
    assert.ok(returnDate instanceof Date);
    assert.equal(returnDate.getFullYear(), 2023);
    assert.equal(returnDate.getMonth(), 11);
    assert.equal(returnDate.getDate(), 15);
    assert.equal(routeRejected, true);
  });

  it('keeps a failed Vitamin A history lookup as the history block instead of throwing', async () => {
    const history = await evaluateAsync(calculate('vitamin_a_history'), runtime({}));
    assert.equal(history, 'error');
    assert.equal(
      vitaminABlock('2019-01-15', '2023-06-15', '2023-06-15', RED, history, BLUE, RED, 'enter'),
      'history',
    );
  });
});
