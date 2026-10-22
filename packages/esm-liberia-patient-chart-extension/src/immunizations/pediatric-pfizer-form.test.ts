import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateAsync } from '@openmrs/esm-expression-evaluator';
import {
  evaluatePediatricPfizerAdministration,
  isPediatricPfizerDose,
  pediatricPfizerDoseId,
  pediatricPfizerStatusLabel,
} from './pediatric-pfizer.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

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
const dose1 = '${var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid}';
const dose2 = '${var.concept.national.pediatric-pfizer-covid-19-dose-2.uuid}';

function questions() {
  return form.pages.flatMap((page: { sections: Array<{ questions?: unknown[] }> }) =>
    page.sections.flatMap((section) => section.questions ?? []));
}

function question(id: string) {
  const found = questions().find((item: { id?: string }) => item.id === id);
  assert.ok(found, id);
  return found as {
    id: string;
    hide?: { hideWhenExpression?: string };
    questionOptions?: {
      answers?: Array<{ concept: string; label: string; hide?: { hideWhenExpression?: string } }>;
      calculate?: { calculateExpression?: string };
      isTransient?: boolean;
    };
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

function variableValue(name: string) {
  const match = variables.match(new RegExp(`^${name.replace(/[.]/g, '\\.')}=(.+)$`, 'm'));
  assert.ok(match, name);
  return match[1].trim();
}

function resolveTokens(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => variableValue(name));
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTokens(item)]));
  }
  return value;
}

const national = resolveTokens(JSON.parse(readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json',
), 'utf8'))['@liberiaemr/esm-liberia-patient-chart-extension'].routineImmunizations) as SequenceIdentityConfig;

describe('Pediatric Pfizer Immunization form entry', () => {
  const vaccine = question('vaccine_name');
  const gate = question('pediatric_pfizer_gate');
  const status = question('pediatric_pfizer_status');

  it('versions the form and keeps the previous identity', () => {
    assert.equal(form.version, '1.8');
    assert.equal(form.uuid, '${var.form.immunization.uuid}');
    const digest = createHash('md5').update('794c4598-ab82-47ca-8d18-483a8abe6f4f_Immunization_1.8').digest();
    digest[6] = (digest[6] & 0x0f) | 0x30;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const derived = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    assert.match(variables, new RegExp(`^var\\.form\\.immunization\\.uuid=${derived}$`, 'm'));
    assert.match(variables, /^var\.form\.immunization\.v1-6\.uuid=337600b2-9ea3-310a-bbc5-cb2dfa221318$/m);
    assert.match(variables, /^var\.form\.immunization\.v1-7\.uuid=e44cf2d4-169e-3c98-a617-f7d937fbcd74$/m);
  });

  it('offers both doses on the form and on the vaccine-name concept', () => {
    const answers = vaccine.questionOptions?.answers ?? [];
    const pfizer = answers.filter((answer) => answer.label.startsWith('Pediatric Pfizer'));
    assert.deepEqual(pfizer.map((answer) => answer.concept), [dose1, dose2]);
    assert.equal(pfizer.every((answer) => answer.hide === undefined), true);
    const row = concepts.split('\n').find((line) => line.startsWith('${var.concept.national.vaccine-name.uuid},'));
    assert.ok(row?.includes(dose1));
    assert.ok(row?.includes(dose2));
    assert.equal(gate.hide?.hideWhenExpression, 'true');
    assert.equal(gate.questionOptions?.isTransient, true);
    assert.equal(status.questionOptions?.isTransient, true);
    assert.match(status.hide?.hideWhenExpression ?? '', /pediatricPfizerDoseId\(vaccine_name,/);
  });

  it('checks the active patient before save and registers the helpers', () => {
    const expression = gate.questionOptions?.calculate?.calculateExpression ?? '';
    assert.match(expression, /pediatricPfizerAdministrationGate\(patient\.id, patient\.birthDate, tdEncounterDate, vaccine_name,/);
    assert.match(expression, new RegExp(dose1.replace(/[$.]/g, '\\$&')));
    assert.match(expression, new RegExp(dose2.replace(/[$.]/g, '\\$&')));
    assert.doesNotMatch(expression, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('pediatricPfizerAdministrationGate', pediatricPfizerAdministrationGate\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('isPediatricPfizerDose', isPediatricPfizerDose\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('pediatricPfizerStatusLabel', pediatricPfizerStatusLabel\)/);
  });

  it('evaluates the shipped gate with the installed expression evaluator', async () => {
    const raw = gate.questionOptions?.calculate?.calculateExpression ?? '';
    assert.match(raw, /vitaminAEditingEncounterUuid\(\)/);
    assert.doesNotMatch(raw, /typeof encounter/);
    assert.doesNotMatch(raw, /encounter\.uuid/);
    assert.equal(
      indexSource.match(/registerFormEngineExpressionHelper\('vitaminAEditingEncounterUuid'/g)?.length ?? 0,
      1,
    );
    const tdGate = question('td_gate').questionOptions?.calculate?.calculateExpression ?? '';
    assert.match(tdGate, /vitaminAEditingEncounterUuid\(\)/);
    const expression = raw.replace(/\$\{([^}]+)\}/g, (_match, name: string) => variableValue(name));
    const dose1Uuid = variableValue('var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid');
    const dose2Uuid = variableValue('var.concept.national.pediatric-pfizer-covid-19-dose-2.uuid');
    const calls: unknown[][] = [];
    const pediatricPfizerAdministrationGate = (
      patientUuid: string,
      birthDateValue: string,
      evaluationDate: string,
      vaccineConceptUuid: string,
      editingEncounterUuid: string,
      dose1ConceptUuid: string,
      dose2ConceptUuid: string,
    ) => {
      calls.push([patientUuid, birthDateValue, evaluationDate, vaccineConceptUuid, editingEncounterUuid, dose1ConceptUuid, dose2ConceptUuid]);
      return evaluatePediatricPfizerAdministration({
        patientUuid,
        birthDate: birthDateValue,
        evaluationDate,
        vaccineConceptUuid,
        editingEncounterUuid,
        dose1ConceptUuid,
        dose2ConceptUuid,
        config: national,
        fhirBaseUrl: 'http://openmrs.local/ws/fhir2/R4',
        restBaseUrl: 'http://openmrs.local/ws/rest/v1',
        fetchPage: async (url) => url.includes('/Immunization')
          ? { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] }
          : { results: [] },
      });
    };
    const evaluate = (vaccineName: string) => evaluateAsync(expression, {
      patient: { id: 'patient-1', birthDate: birthDate() },
      tdEncounterDate: '2025-12-20',
      vaccine_name: vaccineName,
      vitaminAEditingEncounterUuid: () => 'encounter-1',
      pediatricPfizerAdministrationGate,
    });
    assert.equal(await evaluate(dose1Uuid), 'due');
    assert.equal(calls[0][0], 'patient-1');
    assert.equal(calls[0][4], 'encounter-1');
    assert.equal(calls[0][3], dose1Uuid);
    assert.notEqual(calls[0][0], 'patient-2');
    assert.equal(await evaluate(dose2Uuid), 'waiting-for-prerequisite');
    assert.equal(calls[1][3], dose2Uuid);
    assert.equal(calls[1][4], 'encounter-1');
  });

  it('blocks invalid dose 1 and dose 2 saves and allows due or overdue dose 2', () => {
    const validators = vaccine.validators ?? [];
    const fails = (myValue: string, pfizerGate: string) => validators.map((validator) => {
      const evaluate = new Function(
        'myValue', 'td_gate', 'pediatric_pfizer_gate', 'isEmpty', 'isTdVaccine', 'isPediatricPfizerDose',
        `return (${substitute(validator.failsWhenExpression)});`,
      );
      return evaluate(myValue, 'allowed', pfizerGate, isEmpty, () => false, isPediatricPfizerDose);
    });
    const blocked = (myValue: string, pfizerGate: string) => fails(myValue, pfizerGate).some(Boolean);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', ''), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', 'unresolved'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', 'not-yet-due'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', 'not-eligible'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', 'already-given'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-1', 'due'), false);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'waiting-for-prerequisite'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'waiting-for-interval'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'already-given'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'not-eligible'), true);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'due'), false);
    assert.equal(blocked('national.pediatric-pfizer-covid-19-dose-2', 'overdue'), false);
    assert.equal(blocked('national.bcg', 'not-eligible'), false);
    assert.equal(blocked('national.td', 'waiting-for-interval'), false);
    assert.equal(pediatricPfizerDoseId('national.pediatric-pfizer-covid-19-dose-2', 'national.pediatric-pfizer-covid-19-dose-1', 'national.pediatric-pfizer-covid-19-dose-2'), 'PediatricPfizer2');
    assert.equal(pediatricPfizerStatusLabel('overdue'), 'Overdue');
    const label = substitute(status.questionOptions?.calculate?.calculateExpression ?? '');
    const show = new Function('pediatric_pfizer_gate', 'pediatricPfizerStatusLabel', `return (${label});`);
    assert.equal(show('overdue', pediatricPfizerStatusLabel), 'Overdue');
    assert.equal(show('due', pediatricPfizerStatusLabel), 'Due');
  });
});

function birthDate() {
  return '2014-01-01';
}
