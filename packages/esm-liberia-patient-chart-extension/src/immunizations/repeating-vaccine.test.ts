import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAsync } from '@openmrs/esm-expression-evaluator';
import { isPediatricPfizerDose } from './pediatric-pfizer.ts';
import { pediatricPfizerStatusLabel } from './pediatric-pfizer.ts';
import { sameSubmissionVaccineDuplicate } from './same-submission-vaccine.ts';
import { isTdVaccine } from './td-pregnancy.ts';
import { vitaminARouteValue, vitaminASharedReturnValue } from '../forms/vitamin-a-supplementation.ts';

const here = dirname(fileURLToPath(import.meta.url));

function propertiesOf(text: string) {
  const properties = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return properties;
}

const properties = propertiesOf(readFileSync(new URL(
  '../../../../content-packages/content-liberia-national/configuration/variables.properties',
  import.meta.url,
), 'utf8'));

function substitute(expression: string) {
  return expression.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const value = properties.get(name);
    if (!value) throw new Error(`Unresolved ${name}`);
    return value;
  });
}

function variable(name: string) {
  const value = properties.get(name);
  assert.ok(value, name);
  return value;
}

function mentionsBare(expression: string, id: string) {
  return new RegExp(`\\b${id}\\b`).test(expression);
}

function loadProbe() {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--import', resolve(here, 'form-engine-register.mjs'),
    resolve(here, 'repeating-vaccine.probe.mjs'),
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `probe exited ${result.status}`);
  }
  return JSON.parse(result.stdout) as {
    version: string;
    rendering: string;
    addText: string;
    childIds: string[];
    cloneId: string;
    cloneChildren: Array<{
      id: string;
      transient: boolean;
      calculate: string;
      hide: string;
      validators: string[];
    }>;
    forwardReference: string;
    forwardValidator: string;
    one: { concept: string; formFieldPath: string; groupMembers: Array<{ value: string; formFieldPath: string; concept: string }> };
    two: { concept: string; formFieldPath: string; groupMembers: Array<{ value: string; formFieldPath: string }> };
    empty: null;
    hydratedIds: string[];
    initialValues: Record<string, string>;
    valid: boolean;
    row1Value: string;
    row1Route: string;
    row1Errors: unknown;
    row2Errors: Array<{ message: string }>;
    keptValue: string;
    removedValue: null;
    source: Record<string, boolean>;
    deletion: {
      staleVaccineName: string;
      templateChildWasDeleted: boolean;
      groupStillPresent: boolean;
      groupVoided: boolean;
      readd: { values: Record<string, string>; fields: Array<{ id: string; meta?: { groupId?: string; repeat?: { wasDeleted?: boolean } } }> };
      removeOpv: { values: Record<string, string>; fields: Array<{ id: string; meta?: { groupId?: string; repeat?: { wasDeleted?: boolean } } }> };
      unsaved: { values: Record<string, string>; fields: Array<{ id: string; meta?: { groupId?: string; repeat?: { wasDeleted?: boolean } } }> };
    };
  };
}

const probe = loadProbe();
const cloned = (id: string) => {
  const child = probe.cloneChildren.find((item) => item.id === id);
  assert.ok(child, id);
  return child;
};

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '';
}

describe('pinned repeating obs group', () => {
  it('uses form-engine-lib 4.2.2-pre.2449 repeating groups with Add Another Vaccine', () => {
    assert.equal(probe.version, '4.2.2-pre.2449');
    assert.equal(probe.rendering, 'repeating');
    assert.equal(probe.addText, 'Add Another Vaccine');
    assert.deepEqual(probe.childIds, [
      'vaccine_name', 'td_gate', 'pediatric_pfizer_gate', 'pediatric_pfizer_status', 'hpv_gate', 'hpv_status', 'route', 'return_date',
    ]);
    assert.equal(probe.cloneId, 'vaccine_administration_1');
    assert.equal(probe.source.addText, true);
    assert.equal(probe.source.firstRowStays, true);
    assert.equal(probe.source.unregisterRow, true);
  });

  it('rewrites earlier siblings onto the clone and leaves a later sibling untouched', () => {
    const route = cloned('route_1');
    assert.match(route.calculate, /vaccine_name_1/);
    assert.equal(mentionsBare(route.calculate, 'vaccine_name'), false);
    assert.match(route.calculate, /supp_activities/);
    assert.match(cloned('td_gate_1').calculate, /vaccine_name_1/);
    assert.match(cloned('pediatric_pfizer_gate_1').calculate, /vaccine_name_1/);
    assert.equal(cloned('pediatric_pfizer_status_1').calculate, 'pediatricPfizerStatusLabel(pediatric_pfizer_gate_1)');
    assert.equal(cloned('hpv_status_1').calculate, 'hpvStatusLabel(hpv_gate_1)');
    assert.match(cloned('hpv_gate_1').calculate, /vaccine_name_1/);
    assert.match(route.validators.join('\n'), /td_gate_1/);
    assert.match(route.validators.join('\n'), /pediatric_pfizer_gate_1/);
    assert.match(route.validators.join('\n'), /hpv_gate_1/);
    assert.equal(mentionsBare(route.validators.join('\n'), 'td_gate'), false);
    assert.equal(mentionsBare(route.validators.join('\n'), 'pediatric_pfizer_gate'), false);
    assert.equal(mentionsBare(route.validators.join('\n'), 'hpv_gate'), false);
    assert.match(cloned('vaccine_name_1').validators[0], /allFieldValues, allFields/);
    assert.equal(mentionsBare(cloned('vaccine_name_1').validators[0], 'allFieldValues'), true);
    assert.equal(mentionsBare(cloned('vaccine_name_1').validators[0], 'allFields'), true);
    assert.equal(probe.forwardReference, 'routeFrom(vaccine_name_1, return_date)');
    assert.equal(probe.forwardValidator, 'return_date === vaccine_name_1');
    for (const child of probe.cloneChildren) {
      const originalId = child.id.replace(/_\d+$/, '');
      const later = probe.childIds.slice(probe.childIds.indexOf(originalId) + 1);
      const texts = [child.calculate, child.hide, ...child.validators].filter(Boolean);
      for (const id of later) {
        for (const text of texts) assert.equal(mentionsBare(text, id), false, `${child.id} ${id} ${text}`);
      }
    }
  });

  it('submits one obs group per filled vaccine and omits an empty group', () => {
    assert.equal(probe.empty, null);
    assert.equal(probe.one.formFieldPath, 'rfe-forms-vaccine_administration');
    assert.deepEqual(probe.one.groupMembers.map((member) => member.formFieldPath), [
      'rfe-forms-vaccine_name', 'rfe-forms-route', 'rfe-forms-return_date',
    ]);
    assert.equal(probe.two.formFieldPath, 'rfe-forms-vaccine_administration_1');
    assert.deepEqual(probe.two.groupMembers.map((member) => [member.formFieldPath, member.value]), [
      ['rfe-forms-vaccine_name_1', 'opv0-concept'],
      ['rfe-forms-route_1', 'oral-concept'],
      ['rfe-forms-return_date_1', '2024-03-13'],
    ]);
    assert.equal(probe.one.concept, probe.two.concept);
    assert.equal(probe.source.constructGroup, true);
    assert.equal(probe.source.emptyGroupOmitted, true);
    assert.deepEqual(
      probe.one.groupMembers.map((member) => member.concept),
      [
        '${var.concept.national.vaccine-name.uuid}',
        '${var.concept.national.route.uuid}',
        '${var.concept.national.return-date-for-the-next-vaccination.uuid}',
      ],
    );
  });

  it('rehydrates later groups, including a group matched by concept when the path differs', () => {
    assert.deepEqual(probe.hydratedIds, [
      'vaccine_administration_1', 'vaccine_name_1', 'route_1',
      'vaccine_administration_2', 'vaccine_name_2', 'route_2',
    ]);
    assert.equal(probe.initialValues.vaccine_name_1, 'opv0-concept');
    assert.equal(probe.initialValues.route_1, 'oral-concept');
    assert.equal(probe.initialValues.vaccine_name_2, 'bcg-concept');
    assert.equal(probe.initialValues.route_2, '');
    assert.equal(probe.source.hydrateClones, true);
  });

  it('keeps row 1 when row 2 fails validation, and clears only the removed row', () => {
    assert.equal(probe.valid, false);
    assert.equal(probe.row1Value, 'bcg-concept');
    assert.equal(probe.row1Route, 'intradermal-concept');
    assert.equal(probe.row1Errors, null);
    assert.equal(probe.row2Errors[0].message, 'Select a route for this vaccine');
    assert.equal(probe.keptValue, 'intradermal-concept');
    assert.equal(probe.removedValue, null);
  });
});

describe('repeated vaccine expressions stay on their own row', () => {
  const bcg = variable('var.concept.national.bcg.uuid');
  const opv0 = variable('var.concept.national.opv0-1-dose.uuid');
  const td = variable('var.concept.national.td.uuid');
  const pfizer1 = variable('var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid');
  const oral = variable('var.concept.ciel.oral.uuid');
  const blue = variable('var.concept.national.vit-a-blue-100-000iu.uuid');

  it('rejects a repeated vaccine in the unsaved form and allows a different vaccine', async () => {
    const expression = cloned('vaccine_name_1').validators[0];
    const fieldsFor = (ids: string[]) => ids.flatMap((id) => {
      const groupId = id.replace('vaccine_name', 'vaccine_administration');
      return [{ id: groupId, meta: {} }, { id, meta: { groupId } }];
    });
    const fails = (allFieldValues: Record<string, string>) => evaluateAsync(expression, {
      myValue: allFieldValues.vaccine_name_1,
      allFieldValues,
      allFields: fieldsFor(Object.keys(allFieldValues)),
      sameSubmissionVaccineDuplicate,
    });
    assert.equal(await fails({ vaccine_name: bcg, vaccine_name_1: bcg }), true);
    assert.equal(await fails({ vaccine_name: opv0, vaccine_name_1: opv0 }), true);
    assert.equal(await fails({ vaccine_name: bcg, vaccine_name_1: opv0 }), false);
    const entered = { vaccine_name: bcg, vaccine_name_1: bcg };
    assert.equal(await fails(entered), true);
    assert.deepEqual(entered, { vaccine_name: bcg, vaccine_name_1: bcg });
    assert.equal(sameSubmissionVaccineDuplicate('', { vaccine_name: '', vaccine_name_1: bcg }, fieldsFor(['vaccine_name', 'vaccine_name_1'])), false);
    assert.equal(sameSubmissionVaccineDuplicate(bcg, { vaccine_name: bcg }, fieldsFor(['vaccine_name'])), false);
  });

  it('calculates row 2 from row 2 even when row 1 has a different vaccine', async () => {
    const seen: unknown[] = [];
    const tdAdministrationGate = (...args: unknown[]) => {
      seen.push(args[3]);
      return Promise.resolve(args[3]);
    };
    const gate = await evaluateAsync(substitute(cloned('td_gate_1').calculate), {
      patient: { id: 'patient-1', birthDate: '2024-01-31' },
      tdEncounterDate: '2024-01-31',
      vaccine_name: td,
      vaccine_name_1: bcg,
      vitaminAEditingEncounterUuid: () => '',
      tdAdministrationGate,
    });
    assert.equal(gate, bcg);
    assert.deepEqual(seen, [bcg]);

    const status = await evaluateAsync(cloned('pediatric_pfizer_status_1').calculate, {
      pediatric_pfizer_gate: 'due',
      pediatric_pfizer_gate_1: 'already-given',
      pediatricPfizerStatusLabel,
    });
    assert.equal(status, pediatricPfizerStatusLabel('already-given'));
    assert.notEqual(status, pediatricPfizerStatusLabel('due'));

    const route = await evaluateAsync(substitute(cloned('route_1').calculate), {
      vaccine_name: bcg,
      vaccine_name_1: '',
      supp_activities: blue,
      myValue: '',
      vitaminARouteValue,
    });
    assert.equal(route, oral);

    const currentReturn = new Date(2024, 5, 1, 12, 0, 0, 0);
    const returnDate = await evaluateAsync(substitute(cloned('return_date_1').calculate), {
      vaccine_name: '',
      vaccine_name_1: bcg,
      patient: { birthDate: '2019-01-15' },
      vitamin_a_date_received: '2023-06-15',
      supp_activities: blue,
      myValue: currentReturn,
      today: () => '2023-06-15',
      vitaminASharedReturnValue,
    });
    assert.equal(returnDate, currentReturn);
  });

  it('fails the Pfizer already-given check from row 2\'s gate, not row 1\'s', async () => {
    const expression = substitute(cloned('route_1').validators.find((validator) =>
      validator.includes('pediatric-pfizer-covid-19-dose-1') && validator.includes('already-given')) ?? '');
    assert.match(expression, /vaccine_name_1/);
    assert.match(expression, /pediatric_pfizer_gate_1/);
    const fails = (values: Record<string, unknown>) => evaluateAsync(expression, {
      ...values,
      isPediatricPfizerDose,
      isEmpty,
    });
    assert.equal(await fails({
      vaccine_name: bcg,
      pediatric_pfizer_gate: 'due',
      vaccine_name_1: pfizer1,
      pediatric_pfizer_gate_1: 'already-given',
    }), true);
    assert.equal(await fails({
      vaccine_name: pfizer1,
      pediatric_pfizer_gate: 'already-given',
      vaccine_name_1: bcg,
      pediatric_pfizer_gate_1: 'due',
    }), false);
  });

  it('fails the Td pregnancy check from row 2\'s gate, not row 1\'s', async () => {
    const expression = substitute(cloned('route_1').validators.find((validator) => validator.includes('unknown-pregnancy')) ?? '');
    const fails = (values: Record<string, unknown>) => evaluateAsync(expression, { ...values, isTdVaccine, isEmpty });
    assert.equal(await fails({
      vaccine_name: bcg,
      td_gate: 'unknown-pregnancy',
      vaccine_name_1: td,
      td_gate_1: 'unknown-pregnancy',
    }), true);
    assert.equal(await fails({
      vaccine_name: td,
      td_gate: 'unknown-pregnancy',
      vaccine_name_1: bcg,
      td_gate_1: 'allowed',
    }), false);
  });
});

describe('removed persisted rows do not stay in the duplicate check', () => {
  const state = probe.deletion;

  it('reproduces the stale BCG value, then ignores it once the group is gone', () => {
    const { readd } = state;
    assert.equal(state.staleVaccineName, 'bcg');
    assert.equal(state.groupStillPresent, false);
    assert.equal(state.groupVoided, true);
    assert.equal(state.templateChildWasDeleted, false);
    assert.equal(sameSubmissionVaccineDuplicate('bcg', readd.values), true);
    assert.equal(sameSubmissionVaccineDuplicate('bcg', readd.values, readd.fields), false);
    assert.equal(sameSubmissionVaccineDuplicate('opv0', readd.values, readd.fields), false);
  });

  it('ignores a removed persisted OPV0 while BCG stays active', () => {
    const { removeOpv } = state;
    assert.equal(removeOpv.values.vaccine_name_1, 'opv0');
    assert.equal(removeOpv.fields.find((field) => field.id === 'vaccine_name_1')?.meta?.repeat?.wasDeleted, true);
    const values = { ...removeOpv.values, vaccine_name_2: 'opv0' };
    const fields = [
      ...removeOpv.fields,
      { id: 'vaccine_administration_2', meta: {} },
      { id: 'vaccine_name_2', meta: { groupId: 'vaccine_administration_2' } },
    ];
    assert.equal(sameSubmissionVaccineDuplicate('opv0', values), true);
    assert.equal(sameSubmissionVaccineDuplicate('opv0', values, fields), false);
    assert.equal(sameSubmissionVaccineDuplicate('bcg', values, fields), false);
  });

  it('stops blocking after an unsaved duplicate row is removed', () => {
    const { unsaved } = state;
    assert.equal(unsaved.values.vaccine_name_1, undefined);
    assert.equal(sameSubmissionVaccineDuplicate('bcg', unsaved.values, unsaved.fields), false);
  });
});
