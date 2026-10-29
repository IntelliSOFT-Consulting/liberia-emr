import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateAsync } from '@openmrs/esm-expression-evaluator';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import {
  evaluateHpvAdministration,
  hpvDoseId,
  hpvStatusLabel,
  isHpvDose,
  isHpvFemale,
  type HpvGateCode,
} from './hpv.ts';
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
const hpv1Token = '${var.concept.national.hpv1.uuid}';
const hpv2Token = '${var.concept.national.hpv2.uuid}';

function propertiesOf(text: string) {
  const parsed = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    parsed.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return parsed;
}

function resolveTokens(value: unknown, parsed: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      const resolved = parsed.get(name);
      if (!resolved) throw new Error(`Unresolved ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item, parsed));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTokens(item, parsed)]));
  }
  return value;
}

const properties = propertiesOf(variables);
const national = resolveTokens(JSON.parse(readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json',
), 'utf8'))['@liberiaemr/esm-liberia-patient-chart-extension'].routineImmunizations, properties) as SequenceIdentityConfig;

const hpv1 = national.vaccineConceptUuids.HPV1;
const hpv2 = national.vaccineConceptUuids.HPV2;
const birth = '2015-06-15';
const dayBefore9 = '2024-06-14';
const ninth = '2024-06-15';
const age10 = '2025-06-15';
const age13 = '2028-06-15';
const dayBefore14 = '2029-06-14';
const fourteenth = '2029-06-15';

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
  const found = questions().find((item) => item.id === id);
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

function answer(label: string) {
  const found = question('vaccine_name').questionOptions?.answers?.find((item) => item.label === label);
  assert.ok(found, label);
  return found;
}

function hidden(expression: string, scope: Record<string, unknown>) {
  const names = Object.keys(scope);
  return Boolean(new Function(...names, `return (${expression});`)(...names.map((name) => scope[name])));
}

const hpvValidators = (question('route').validators ?? []).filter((validator) => validator.failsWhenExpression.includes('isHpvDose'));

function failures(vaccineName: string, hpvGate: string) {
  return hpvValidators.flatMap((validator) => {
    const evaluate = new Function(
      'vaccine_name', 'hpv_gate', 'isEmpty', 'isHpvDose',
      `return (${substitute(validator.failsWhenExpression)}) ? ${JSON.stringify(validator.message)} : '';`,
    );
    const message = evaluate(vaccineName, hpvGate, isEmpty, isHpvDose);
    return message ? [message as string] : [];
  });
}

function blocked(vaccineName: string, hpvGate: string) {
  return failures(vaccineName, hpvGate).length > 0;
}

function fhir(conceptUuid: string, date: string, id: string, patient = 'patient-1'): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patient}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function formEncounter(conceptUuid: string, date: string, id: string, formUuid = national.nationalFormUuids.at(-1)!): NationalEncounter {
  return {
    uuid: `enc-${id}`, patient: { uuid: 'patient-1' }, form: { uuid: formUuid }, encounterDatetime: date,
    obs: [{ uuid: id, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function bundle(records: FhirImmunization[]) {
  return {
    resourceType: 'Bundle', type: 'searchset', total: records.length,
    entry: records.map((resource) => ({ resource })),
  };
}

async function code(input: {
  gender?: unknown;
  birthDate?: string;
  evaluationDate: string;
  vaccineConceptUuid: string;
  fhir?: FhirImmunization[];
  encounters?: NationalEncounter[];
  editingEncounterUuid?: string;
  fetchPage?: (url: string) => Promise<unknown>;
}): Promise<HpvGateCode> {
  const fhirRecords = input.fhir ?? [];
  const encounters = input.encounters ?? [];
  return evaluateHpvAdministration({
    patientUuid: 'patient-1',
    gender: input.gender === undefined ? 'female' : input.gender,
    birthDate: input.birthDate ?? birth,
    evaluationDate: input.evaluationDate,
    vaccineConceptUuid: input.vaccineConceptUuid,
    editingEncounterUuid: input.editingEncounterUuid,
    hpv1ConceptUuid: hpv1,
    hpv2ConceptUuid: hpv2,
    config: national,
    fhirBaseUrl: 'http://openmrs.local/ws/fhir2/R4',
    restBaseUrl: 'http://openmrs.local/ws/rest/v1',
    fetchPage: input.fetchPage ?? (async (url) => url.includes('/Immunization')
      ? bundle(fhirRecords)
      : { results: encounters }),
  });
}

describe('HPV Immunization form entry', () => {
  const hpv1Answer = answer('HPV1');
  const hpv2Answer = answer('HPV2');
  const offer = question('hpv2_offer');
  const gate = question('hpv_gate');
  const status = question('hpv_status');

  it('registers the gate against the current form and the vaccine-name concept', () => {
    assert.equal(form.version, '1.13');
    const group = question('vaccine_administration') as { questions?: Array<{ id?: string }> };
    assert.equal(group.questions?.some((child) => child.id === 'hpv2_offer'), false);
    assert.equal(questions().some((item) => item.id === 'hpv2_offer'), true);
    assert.equal(offer.hide?.hideWhenExpression, 'true');
    assert.equal(offer.questionOptions?.isTransient, true);
    assert.equal(gate.hide?.hideWhenExpression, 'true');
    assert.equal(gate.questionOptions?.isTransient, true);
    assert.equal(status.questionOptions?.isTransient, true);
    assert.match(offer.questionOptions?.calculate?.calculateExpression ?? '', /hpvAdministrationGate\(patient\.id, patient\.gender, patient\.birthDate, tdEncounterDate, '\$\{var\.concept\.national\.hpv2\.uuid\}'/);
    assert.match(gate.questionOptions?.calculate?.calculateExpression ?? '', /hpvAdministrationGate\(patient\.id, patient\.gender, patient\.birthDate, tdEncounterDate, vaccine_name,/);
    assert.doesNotMatch(gate.questionOptions?.calculate?.calculateExpression ?? '', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('hpvAdministrationGate', hpvAdministrationGate\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('isHpvDose', isHpvDose\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('hpvDoseId', hpvDoseId\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('hpvStatusLabel', hpvStatusLabel\)/);
    const row = concepts.split('\n').find((line) => line.startsWith('${var.concept.national.vaccine-name.uuid},'));
    assert.ok(row?.includes(hpv1Token));
    assert.ok(row?.includes(hpv2Token));
    assert.equal(hpvDoseId(hpv2, hpv1, hpv2), 'HPV2');
    assert.equal(isHpvFemale('female'), true);
    assert.equal(isHpvFemale('F'), true);
    assert.equal(isHpvFemale('f'), true);
    assert.equal(isHpvFemale('male'), false);
    assert.equal(isHpvFemale('M'), false);
  });

  it('shows HPV1 only for a female from age 9 through 13', () => {
    const expression = hpv1Answer.hide?.hideWhenExpression ?? '';
    assert.equal(expression, "!((patient.gender ?? '').toLowerCase() === 'female' || (patient.gender ?? '').toLowerCase() === 'f') || age < 9 || age >= 14");
    const shown = (gender: unknown, age: number) => !hidden(expression, { patient: { gender }, age });
    assert.equal(shown('female', 8), false);
    assert.equal(shown('female', 9), true);
    assert.equal(shown('female', 10), true);
    assert.equal(shown('F', 10), true);
    assert.equal(shown('f', 10), true);
    assert.equal(shown('female', 13), true);
    assert.equal(shown('female', 14), false);
    assert.equal(shown('male', 10), false);
    assert.equal(shown('M', 10), false);
    assert.equal(shown('other', 10), false);
    assert.equal(shown('unknown', 10), false);
    assert.equal(shown(undefined, 10), false);
    assert.equal(shown(null, 10), false);
    assert.equal(shown('', 10), false);
  });

  it('offers HPV2 only when the patient-level sequence result is due or overdue', () => {
    const expression = hpv2Answer.hide?.hideWhenExpression ?? '';
    assert.equal(expression, "hpv2_offer !== 'due' && hpv2_offer !== 'overdue'");
    const shown = (hpv2Offer: string) => !hidden(expression, { hpv2_offer: hpv2Offer });
    assert.equal(shown(''), false);
    assert.equal(shown('waiting-for-prerequisite'), false);
    assert.equal(shown('waiting-for-interval'), false);
    assert.equal(shown('not-female'), false);
    assert.equal(shown('not-yet-due'), false);
    assert.equal(shown('not-eligible'), false);
    assert.equal(shown('already-given'), false);
    assert.equal(shown('unresolved'), false);
    assert.equal(shown('due'), true);
    assert.equal(shown('overdue'), true);
  });

  it('evaluates the shipped gate with the installed expression evaluator', async () => {
    const raw = gate.questionOptions?.calculate?.calculateExpression ?? '';
    const expression = raw.replace(/\$\{([^}]+)\}/g, (_match, name: string) => properties.get(name) ?? '');
    const calls: unknown[][] = [];
    const hpvAdministrationGate = (
      patientUuid: string,
      gender: unknown,
      birthDateValue: string,
      evaluationDate: string,
      vaccineConceptUuid: string,
      editingEncounterUuid: string,
      hpv1ConceptUuid: string,
      hpv2ConceptUuid: string,
    ) => {
      calls.push([patientUuid, gender, birthDateValue, evaluationDate, vaccineConceptUuid, editingEncounterUuid, hpv1ConceptUuid, hpv2ConceptUuid]);
      return evaluateHpvAdministration({
        patientUuid,
        gender,
        birthDate: birthDateValue,
        evaluationDate,
        vaccineConceptUuid,
        editingEncounterUuid,
        hpv1ConceptUuid,
        hpv2ConceptUuid,
        config: national,
        fhirBaseUrl: 'http://openmrs.local/ws/fhir2/R4',
        restBaseUrl: 'http://openmrs.local/ws/rest/v1',
        fetchPage: async (url) => url.includes('/Immunization')
          ? { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] }
          : { results: [] },
      });
    };
    const result = await evaluateAsync(expression, {
      patient: { id: 'patient-1', gender: 'female', birthDate: birth },
      tdEncounterDate: age10,
      vaccine_name: hpv1,
      vitaminAEditingEncounterUuid: () => 'encounter-1',
      hpvAdministrationGate,
    });
    assert.equal(result, 'due');
    assert.equal(calls[0][0], 'patient-1');
    assert.equal(calls[0][1], 'female');
    assert.equal(calls[0][4], hpv1);
    assert.equal(calls[0][5], 'encounter-1');
    const label = substitute(status.questionOptions?.calculate?.calculateExpression ?? '');
    const show = new Function('hpv_gate', 'hpvStatusLabel', `return (${label});`);
    assert.equal(show('due', hpvStatusLabel), 'Due');
    assert.equal(show('overdue', hpvStatusLabel), 'Overdue');
    assert.equal(show('unresolved', hpvStatusLabel), 'History could not be resolved');
  });

  it('blocks an invalid HPV save from the shipped validators and allows due or overdue', async () => {
    const cases: Array<[string, string, HpvGateCode, string | null]> = [
      ['day before the 9th birthday', dayBefore9, 'not-yet-due', 'too young'],
      ['9th birthday', ninth, 'due', null],
      ['age 10', age10, 'due', null],
      ['age 13', age13, 'due', null],
      ['day before the 14th birthday', dayBefore14, 'due', null],
      ['14th birthday', fourteenth, 'not-eligible', 'too old'],
    ];
    for (const [label, date, expected, message] of cases) {
      const result = await code({ evaluationDate: date, vaccineConceptUuid: hpv1 });
      assert.equal(result, expected, label);
      const messages = failures('national.hpv1', result);
      assert.equal(blocked('national.hpv1', result), message !== null, label);
      if (message) assert.ok(messages.some((item) => item.toLowerCase().includes(message)), `${label} ${messages.join('; ')}`);
    }
    for (const gender of ['female', 'F', 'f']) {
      assert.equal(await code({ gender, evaluationDate: age10, vaccineConceptUuid: hpv1 }), 'due', String(gender));
    }
    const male = await code({ gender: 'male', evaluationDate: age10, vaccineConceptUuid: hpv1 });
    assert.equal(male, 'not-female');
    assert.ok(failures('national.hpv1', male).some((item) => item.toLowerCase().includes('not eligible by sex')));
    for (const gender of ['M', 'other', 'unknown', null, '']) {
      assert.equal(await code({ gender, evaluationDate: age10, vaccineConceptUuid: hpv1 }), 'not-female', String(gender));
    }
    assert.equal(isHpvFemale(undefined), false);

    const duplicate = await code({ evaluationDate: age10, vaccineConceptUuid: hpv1, fhir: [fhir(hpv1, ninth, 'fhir-hpv1')] });
    assert.equal(duplicate, 'already-given');
    assert.ok(failures('national.hpv1', duplicate).some((item) => item.includes('HPV1 is already given')));

    const missing = await code({ birthDate: '2015-01-01', evaluationDate: '2025-02-28', vaccineConceptUuid: hpv2 });
    assert.equal(missing, 'waiting-for-prerequisite');
    assert.ok(failures('national.hpv2', missing).some((item) => item.includes('HPV2 requires HPV1')));

    const first = '2024-08-31';
    const prior = [fhir(hpv1, first, 'fhir-hpv1')];
    const early = await code({ birthDate: '2015-01-01', evaluationDate: '2025-02-27', vaccineConceptUuid: hpv2, fhir: prior });
    assert.equal(early, 'waiting-for-interval');
    assert.ok(failures('national.hpv2', early).some((item) => item.includes('HPV2 is not yet due')));
    const exact = await code({ birthDate: '2015-01-01', evaluationDate: '2025-02-28', vaccineConceptUuid: hpv2, fhir: prior });
    assert.equal(exact, 'due');
    assert.equal(blocked('national.hpv2', exact), false);
    const later = await code({ birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2, fhir: prior });
    assert.equal(later, 'overdue');
    assert.equal(blocked('national.hpv2', later), false);
    assert.equal(hpvStatusLabel(later), 'Overdue');

    const second = await code({
      birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2,
      fhir: [...prior, fhir(hpv2, '2025-02-28', 'fhir-hpv2')],
    });
    assert.equal(second, 'already-given');
    assert.ok(failures('national.hpv2', second).some((item) => item.includes('HPV2 is already given')));

    const fromForm = await code({
      birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2,
      encounters: [formEncounter(hpv1, first, 'form-hpv1')],
    });
    assert.equal(fromForm, 'overdue');
    const fromFrozenForm = await code({
      birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2,
      encounters: [formEncounter(hpv1, first, 'old-form-hpv1', properties.get('var.form.immunization.v1-11.uuid')!)],
    });
    assert.equal(fromFrozenForm, 'overdue');

    const conflict = await code({
      evaluationDate: age10, vaccineConceptUuid: hpv1,
      fhir: [fhir(hpv1, ninth, 'one'), fhir(hpv1, age10, 'two')],
    });
    assert.equal(conflict, 'unresolved');
    assert.ok(failures('national.hpv1', conflict).some((item) => item.toLowerCase().includes('history could not be resolved')));
    const badDate = fhir(hpv1, 'not-a-date', 'bad');
    assert.equal(await code({ birthDate: '2010-01-01', evaluationDate: '2020-01-01', vaccineConceptUuid: hpv2, fhir: [badDate] }), 'unresolved');
    const unknown = fhir('not-a-known-vaccine', age10, 'unknown');
    assert.equal(await code({ evaluationDate: age10, vaccineConceptUuid: hpv1, fhir: [unknown] }), 'unresolved');

    const unavailable = await code({
      evaluationDate: age10, vaccineConceptUuid: hpv1,
      fetchPage: async () => { throw new Error('history down'); },
    });
    assert.equal(unavailable, 'unresolved');
    assert.equal(blocked('national.hpv1', unavailable), true);
    const tooYoungOffline = await code({
      evaluationDate: dayBefore9, vaccineConceptUuid: hpv1,
      fetchPage: async () => { throw new Error('history down'); },
    });
    assert.equal(tooYoungOffline, 'not-yet-due');
    const hpv2Offline = await code({
      evaluationDate: age10, vaccineConceptUuid: hpv2,
      fetchPage: async () => { throw new Error('history down'); },
    });
    assert.equal(hpv2Offline, 'unresolved');

    assert.equal(blocked('national.bcg', 'not-eligible'), false);
    assert.equal(blocked('national.td', 'waiting-for-interval'), false);
    assert.equal(await code({ evaluationDate: age10, vaccineConceptUuid: national.vaccineConceptUuids.BCG }), 'allowed');

    const savedOnV112 = await code({
      birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2,
      encounters: [formEncounter(hpv1, first, 'v112-hpv1', properties.get('var.form.immunization.v1-12.uuid')!)],
    });
    assert.equal(savedOnV112, 'overdue');
  });

  it('excludes only the HPV dose on the encounter being edited', async () => {
    const current = formEncounter(hpv1, ninth, 'editing');
    assert.equal(await code({
      evaluationDate: age10, vaccineConceptUuid: hpv1, encounters: [current], editingEncounterUuid: current.uuid,
    }), 'due');
    assert.equal(await code({
      evaluationDate: age10, vaccineConceptUuid: hpv1, encounters: [current],
    }), 'already-given');
    const other = formEncounter(hpv1, age10, 'other');
    assert.equal(await code({
      evaluationDate: age10, vaccineConceptUuid: hpv1, encounters: [current, other], editingEncounterUuid: current.uuid,
    }), 'already-given');
    const sameEncounter = formEncounter(hpv1, '2024-08-31', 'same');
    assert.equal(await code({
      birthDate: '2015-01-01', evaluationDate: '2025-03-01', vaccineConceptUuid: hpv2,
      encounters: [sameEncounter], editingEncounterUuid: sameEncounter.uuid,
    }), 'overdue');
  });
});
