import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { administeredTimeline, type FhirImmunization, type NationalEncounter } from './history.ts';
import { routineNextDoseDate } from './routine-dose-gate.ts';
import { routeRequired, vaccineNameRequired } from './same-submission-vaccine.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import routes from '../routes.json' with { type: 'json' };

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const patientUuid = 'patient-1';
const root = new URL('../../../../', import.meta.url);

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

function resolveTokens(value: string, parsed: Map<string, string>) {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const resolved = parsed.get(name);
    if (!resolved) throw new Error(`Unresolved ${name}`);
    return resolved;
  });
}

const properties = propertiesOf(readFileSync(new URL('content-packages/content-liberia-national/configuration/variables.properties', root), 'utf8'));
const config = JSON.parse(readFileSync(new URL('content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json', root), 'utf8'));
const form = JSON.parse(readFileSync(new URL('content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json', root), 'utf8'));
const concepts = readFileSync(new URL('content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv', root), 'utf8');
const aefi = readFileSync(new URL('content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/aefi-national.json', root), 'utf8');
const widgetSource = readFileSync(new URL('../liberia-obs-widget/liberia-obs-widget.component.tsx', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const national = JSON.parse(resolveTokens(JSON.stringify(config[moduleName].routineImmunizations), properties)) as SequenceIdentityConfig;

function questions(node: unknown, found: Array<Record<string, any>> = []) {
  if (Array.isArray(node)) node.forEach((item) => questions(item, found));
  else if (node && typeof node === 'object') {
    const record = node as Record<string, any>;
    if (typeof record.id === 'string' && typeof record.type === 'string') found.push(record);
    Object.values(record).forEach((item) => questions(item, found));
  }
  return found;
}

const formQuestions = questions(form);
const question = (id: string) => {
  const found = formQuestions.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};
const fails = (item: Record<string, any>, message: string) => {
  const validator = (item.validators ?? []).find((entry: { message?: string }) => entry.message === message);
  assert.ok(validator, message);
  return validator.failsWhenExpression as string;
};
const isEmpty = (value: unknown) => value === undefined || value === null || value === '';

describe('immunization entry', () => {
  it('opens the national Immunization form from Clinical Forms and from Immunizations Add', () => {
    const section = config['@openmrs/esm-patient-forms-app'].formSections.find((item: { name: string }) => item.name === 'Immunization');
    const widget = config['liberia-immunization-history'];
    const removed = config['@openmrs/esm-patient-chart-app'].extensionSlots['patient-chart-immunizations-dashboard-slot'].remove;
    assert.deepEqual(section.forms, ['Immunization', 'Adverse Event Following Immunization (AEFI)']);
    assert.equal(form.name, 'Immunization');
    assert.equal(form.uuid, '${var.form.immunization.uuid}');
    assert.equal(widget.formUuid, form.uuid);
    assert.equal(widget.showAddButton, true);
    assert.deepEqual(widget.formUuids, config[moduleName].routineImmunizations.nationalFormUuids);
    assert.deepEqual(removed, ['immunization-details-widget']);
    assert.equal(removed.includes('immunization-detailed-history-card'), false);
    assert.equal(JSON.stringify(config).includes('immunization-form-workspace'), false);
    assert.match(widgetSource, /launchWorkspace2\('patient-form-entry-workspace'/);
    assert.equal(routes.extensions.some((extension) => extension.name === 'liberia-immunization-history'
      && extension.slot === 'patient-chart-immunizations-dashboard-slot'), true);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('routineDoseOutsideWindow', routineDoseOutsideWindow\)/);
    assert.match(indexSource, /registerFormEngineExpressionHelper\('routineNextDoseDate', routineNextDoseDate\)/);
  });

  it('adds the existing schedule concepts to Vaccine Name and leaves route, AEFI, and upstream fields alone', () => {
    const answers = question('vaccine_name').questionOptions.answers as Array<{ concept: string; label: string }>;
    const added = [
      ['${var.concept.national.penta-1.uuid}', 'Penta 1'],
      ['${var.concept.national.pneumo-1.uuid}', 'Pneumo 1'],
      ['${var.concept.national.rota-1.uuid}', 'Rota 1'],
      ['${var.concept.national.opv2.uuid}', 'OPV2'],
      ['${var.concept.national.penta-2.uuid}', 'Penta 2'],
      ['${var.concept.national.pneumo-2.uuid}', 'Pneumo 2'],
      ['${var.concept.national.rota-2.uuid}', 'Rota 2'],
      ['${var.concept.national.opv3.uuid}', 'OPV3'],
      ['${var.concept.national.penta-3.uuid}', 'Penta 3'],
      ['${var.concept.national.pneumo-3.uuid}', 'Pneumo 3'],
      ['${var.concept.national.ipv.uuid}', 'IPV'],
      ['${var.concept.national.mcv1.uuid}', 'MCV1'],
      ['${var.concept.national.mcv2.uuid}', 'MCV2'],
      ['${var.concept.national.tcv.uuid}', 'TCV'],
      ['${var.concept.national.yellow-fever.uuid}', 'Yellow Fever'],
      ['${var.concept.national.malaria-vaccine-dose-1.uuid}', 'Malaria Vaccine dose 1'],
      ['${var.concept.national.malaria-vaccine-dose-2.uuid}', 'Malaria Vaccine dose 2'],
      ['${var.concept.national.malaria-vaccine-dose-3.uuid}', 'Malaria Vaccine dose 3'],
      ['${var.concept.national.malaria-vaccine-dose-4.uuid}', 'Malaria Vaccine dose 4'],
      ['${var.concept.national.hpv1.uuid}', 'HPV1'],
      ['${var.concept.national.hpv2.uuid}', 'HPV2'],
      ['${var.concept.national.pfizer.uuid}', 'Pfizer'],
      ['${var.concept.national.j-j.uuid}', 'J & J'],
      ['${var.concept.national.covid-19-booster.uuid}', 'COVID-19 Booster'],
    ];
    for (const [concept, label] of added) {
      assert.equal(answers.some((answer) => answer.concept === concept && answer.label === label), true, label);
    }
    const conceptRow = concepts.split('\n').find((line) => line.startsWith('${var.concept.national.vaccine-name.uuid},'));
    assert.ok(conceptRow);
    assert.deepEqual(
      answers.map((answer) => answer.concept),
      conceptRow.split(',')[7].split(';'),
    );
    assert.deepEqual(question('route').questionOptions.answers.map((answer: { label: string }) => answer.label), ['Oral']);
    assert.equal(formQuestions.some((item) => ['aefi_vaccine_name', 'aefi_batch_number', 'aefi_onset_date', 'aefi_complaint'].includes(item.id)), false);
    assert.match(aefi, /"id": "aefi_vaccine_name"[\s\S]*"required": true/);
    assert.match(aefi, /"id": "aefi_batch_number"[\s\S]*"required": true/);
    const text = JSON.stringify(form);
    for (const absent of ['vaccine-manufacturer', 'vaccine-lot-number', 'vaccine-lot-expiration', 'Vaccine Registration', 'intradermal', 'subcutaneous', 'intramuscular']) {
      assert.equal(text.toLowerCase().includes(absent.toLowerCase()), false, absent);
    }
    for (const demographic of ['moh-health-record', 'national-id', 'telephone-number', 'good-samaritan']) {
      assert.equal(text.includes(demographic), false, demographic);
    }
  });

  it('requires vaccine, route, date received, and a shown caregiver, and requires return date only for a next dose', () => {
    const date = question('tdEncounterDate');
    assert.equal(date.label, 'Date received');
    assert.equal(date.type, 'encounterDatetime');
    assert.equal(date.required, true);
    assert.equal(formQuestions.filter((item) => item.type === 'encounterDatetime').length, 1);
    const vaccineExpression = fails(question('vaccine_name'), 'Vaccine Name is required.');
    const routeExpression = fails(question('route'), 'Route is required.');
    const caregiverRequired = fails(question('parent_caregiver'), 'Parent/Caregiver is required.');
    const phoneRequired = fails(question('caregiver_phone_number'), 'Caregiver phone number is required.');
    const returnRequired = resolveTokens(fails(question('return_date'), 'Return date is required for the next dose.'), properties);
    const vitaminARequired = fails(question('vitamin_a_date_received'), 'Date received is required for Vitamin A.');
    const fields = [
      { id: 'vaccine_administration', meta: {} },
      { id: 'vaccine_name', meta: { groupId: 'vaccine_administration' } },
      { id: 'route', meta: { groupId: 'vaccine_administration' } },
      { id: 'return_date', meta: { groupId: 'vaccine_administration' } },
      { id: 'vaccine_administration_1', meta: {} },
      { id: 'vaccine_name_1', meta: { groupId: 'vaccine_administration_1' } },
      { id: 'route_1', meta: { groupId: 'vaccine_administration_1' } },
      { id: 'return_date_1', meta: { groupId: 'vaccine_administration_1' } },
    ];
    const run = (expression: string, scope: Record<string, unknown>) => Boolean(new Function(
      ...Object.keys(scope),
      `return (${expression});`,
    )(...Object.values(scope)));
    const row = (id: string, values: Record<string, unknown>, vitaminA = '') => run(
      id.startsWith('route') ? routeExpression : vaccineExpression,
      {
        myValue: '',
        node: { value: { id } },
        allFieldValues: values,
        allFields: fields,
        supp_activities: vitaminA,
        vaccineNameRequired,
        routeRequired,
      },
    );
    assert.equal(row('vaccine_name', { vaccine_name: '', route: '', return_date: '' }), false);
    assert.equal(row('vaccine_name', { vaccine_name: '', route: 'oral', return_date: '' }), true);
    assert.equal(row('vaccine_name', { vaccine_name: '', route: 'oral', return_date: '2024-04-01' }, 'blue'), false);
    assert.equal(row('vaccine_name_1', { route: 'oral', route_1: '', return_date_1: '' }), false);
    assert.equal(row('vaccine_name_1', { route: '', route_1: 'oral', return_date_1: '' }), true);
    assert.equal(row('route', { vaccine_name: '', route: '', return_date: '' }), false);
    assert.equal(row('route', { vaccine_name: 'bcg', route: '', return_date: '' }), true);
    assert.equal(row('route', { vaccine_name: '', route: '', return_date: '2024-04-01' }, 'blue'), false);
    assert.equal(row('route_1', { vaccine_name: 'bcg', vaccine_name_1: '', return_date: '2024-04-01', return_date_1: '' }), false);
    assert.equal(run(caregiverRequired, { age: 10, myValue: '', isEmpty }), true);
    assert.equal(run(caregiverRequired, { age: 19, myValue: '', isEmpty }), false);
    assert.equal(run(caregiverRequired, { age: 10, myValue: 'Parent', isEmpty }), false);
    assert.equal(run(phoneRequired, { age: 10, myValue: '', isEmpty }), true);
    assert.equal(run(phoneRequired, { age: 19, myValue: '', isEmpty }), false);
    const birth = properties.get('var.concept.national.bcg.uuid');
    const opv1 = properties.get('var.concept.national.opv1.uuid');
    const scope = {
      vaccine_name: birth,
      myValue: '',
      patient: { birthDate: '2024-01-01' },
      tdEncounterDate: '2024-02-01',
      isEmpty,
      routineNextDoseDate,
    };
    assert.equal(run(returnRequired, scope), false);
    assert.equal(run(returnRequired, { ...scope, vaccine_name: opv1, tdEncounterDate: '2024-02-12' }), true);
    assert.equal(run(returnRequired, { ...scope, vaccine_name: opv1, tdEncounterDate: '2024-02-12', myValue: '2024-03-11' }), false);
    assert.equal(run(vitaminARequired, { supp_activities: '', myValue: '', isEmpty }), false);
    assert.equal(run(vitaminARequired, { supp_activities: 'blue', myValue: '', isEmpty }), true);
    assert.equal(question('vaccine_name').required, undefined);
    assert.equal(question('route').required, undefined);
    assert.equal(question('return_date').required, undefined);
  });
});

describe('unified immunization history', () => {
  const currentForm = national.nationalFormUuids.at(-1)!;
  const frozenForm = properties.get('var.form.immunization.v1-11.uuid')!;

  function fhir(conceptUuid: string, date: string, id: string): FhirImmunization {
    return {
      resourceType: 'Immunization', id, status: 'completed',
      patient: { reference: `Patient/${patientUuid}` },
      vaccineCode: { coding: [{ code: conceptUuid }] },
      occurrenceDateTime: date,
    };
  }

  function encounter(conceptUuid: string, date: string, id: string, formUuid = currentForm): NationalEncounter {
    return {
      uuid: id, patient: { uuid: patientUuid }, form: { uuid: formUuid }, encounterDatetime: date,
      obs: [{ uuid: `${id}-obs`, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
    };
  }

  it('keeps a legacy FHIR record, counts one national save once, and ignores AEFI', () => {
    const bcg = national.vaccineConceptUuids.BCG;
    const penta = national.vaccineConceptUuids.Penta1;
    const result = administeredTimeline({
      patientUuid,
      fhir: [fhir(bcg, '2024-02-01', 'legacy-bcg')],
      encounters: [
        encounter(penta, '2024-03-13', 'national-penta'),
        encounter(bcg, '2024-02-01', 'same-day-bcg'),
        {
          uuid: 'aefi-visit', patient: { uuid: patientUuid },
          form: { uuid: properties.get('var.form.aefi.uuid')! },
          encounterDatetime: '2024-03-20',
          obs: [{
            uuid: 'aefi-obs',
            concept: { uuid: properties.get('var.concept.national.aefi-vaccine.uuid')! },
            value: { uuid: penta },
          }],
        },
      ],
      config: national,
    });
    assert.equal(result.unresolved, false);
    const doses = result.entries.filter((entry) => !entry.vitaminAStrength).map((entry) => entry.canonicalDoseId);
    assert.deepEqual(doses.slice().sort(), ['BCG', 'Penta1']);
    assert.equal(result.entries.filter((entry) => entry.canonicalDoseId === 'BCG').length, 1);
    assert.equal(result.entries.filter((entry) => entry.canonicalDoseId === 'Penta1').length, 1);
    const historical = administeredTimeline({
      patientUuid,
      fhir: [],
      encounters: [encounter(penta, '2024-03-13', 'historical-penta', frozenForm)],
      config: national,
    });
    assert.deepEqual(historical.entries.map((entry) => entry.canonicalDoseId), ['Penta1']);
  });
});
