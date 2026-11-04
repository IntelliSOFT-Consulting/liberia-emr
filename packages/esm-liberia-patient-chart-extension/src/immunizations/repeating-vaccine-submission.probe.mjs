import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const repoRoot = resolve(packageRoot, '../..');
const version = JSON.parse(readFileSync(require.resolve('@openmrs/esm-form-engine-lib/package.json'), 'utf8')).version;

const { cloneRepeatField } = await import('@openmrs/esm-form-engine-lib/dist/components/repeat/helpers.js');
const { ObsAdapter } = await import('@openmrs/esm-form-engine-lib/dist/adapters/obs-adapter.js');
const { ControlAdapter } = await import('@openmrs/esm-form-engine-lib/dist/adapters/control-adapter.js');
const { prepareEncounter } = await import(
  '@openmrs/esm-form-engine-lib/dist/processors/encounter/encounter-processor-helper.js'
);
const { DefaultFormSchemaTransformer } = await import(
  '@openmrs/esm-form-engine-lib/dist/transformers/default-schema-transformer.js'
);
const { tdAdministrationGate } = await import('./td-administration-gate.ts');
const { pediatricPfizerDoseId, pediatricPfizerStatusLabel } = await import('./pediatric-pfizer.ts');

const adapters = { obs: ObsAdapter, obsGroup: ObsAdapter, control: ControlAdapter };

function propertiesOf(text) {
  const properties = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return properties;
}

const properties = propertiesOf(readFileSync(resolve(
  repoRoot,
  'content-packages/content-liberia-national/configuration/variables.properties',
), 'utf8'));

function substitute(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name) => {
      const resolved = properties.get(name);
      if (!resolved) throw new Error(`Unresolved ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]));
  }
  return value;
}

const rawForm = substitute(JSON.parse(readFileSync(resolve(
  repoRoot,
  'content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
), 'utf8')));

const bcg = properties.get('var.concept.national.bcg.uuid');
const opv1 = properties.get('var.concept.national.opv1.uuid');
const opv0 = properties.get('var.concept.national.opv0-1-dose.uuid');
const oral = properties.get('var.concept.ciel.oral.uuid');
const dose1 = properties.get('var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid');
const dose2 = properties.get('var.concept.national.pediatric-pfizer-covid-19-dose-2.uuid');
const td1 = properties.get('var.concept.national.td.uuid');
const td2 = properties.get('var.concept.national.td2.uuid');
const td3 = properties.get('var.concept.national.td3.uuid');
const td4 = properties.get('var.concept.national.td4.uuid');
const td5 = properties.get('var.concept.national.td5.uuid');

function freshFields() {
  const form = DefaultFormSchemaTransformer.transform(structuredClone(rawForm));
  const flattened = [];
  const processField = (field, parentGroupId) => {
    const processed = parentGroupId
      ? { ...field, meta: { ...field.meta, groupId: parentGroupId } }
      : field;
    flattened.push(processed);
    if (processed.type === 'obsGroup' && processed.questions) {
      for (const nested of processed.questions) processField(nested, processed.id);
    }
  };
  for (const page of form.pages) {
    for (const section of page.sections ?? []) {
      for (const question of section.questions ?? []) processField(question);
    }
  }
  return flattened;
}

function fieldById(fields, id) {
  const field = fields.find((item) => item.id === id);
  if (!field) throw new Error(`Missing field ${id}`);
  return field;
}

function commitUserValue(fields, id, value) {
  const field = fieldById(fields, id);
  adapters[field.type].transformFieldValue(field, value, {});
  if (field.meta?.groupId) {
    const group = fieldById(fields, field.meta.groupId);
    group.questions = group.questions.map((child) => (child.id === field.id ? field : child));
  }
}

function commitCalculated(fields, id, value) {
  const field = fieldById(fields, id);
  adapters[field.type]?.transformFieldValue(field, value, {});
}

function addRepeat(fields, suffix, calculated) {
  const template = fieldById(fields, 'vaccine_administration');
  const cloned = cloneRepeatField(template, null, suffix);
  const buffer = [cloned, ...(cloned.questions ?? [])];
  for (const field of buffer) {
    if (Object.prototype.hasOwnProperty.call(calculated, field.id)) {
      const value = calculated[field.id];
      if (value !== undefined && value !== null && value !== '') {
        adapters[field.type]?.transformFieldValue(field, value, {});
      }
    }
    fields.push(field);
  }
  return cloned;
}

async function gateValue(vaccine) {
  const code = await tdAdministrationGate(
    'patient', '2020-01-01', '2026-10-26', vaccine, '',
    'pregnancy', 'tri1', 'tri2', 'tri3', 'vaccine-name',
    td1, 'tt1', td2, 'tt2', td3, 'tt3', td4, 'tt4', td5, 'tt5',
  );
  const doseId = pediatricPfizerDoseId(vaccine, dose1, dose2);
  return {
    td: code,
    pfizer: doseId ? 'needs-history' : 'allowed',
    statusNow: pediatricPfizerStatusLabel(undefined),
    statusSettled: pediatricPfizerStatusLabel('allowed'),
    hpv: 'allowed',
    hpvStatus: '',
  };
}

function settleRow(fields, suffix, vaccine, route, returnDate, gates) {
  const id = (name) => (suffix ? `${name}_${suffix}` : name);
  commitCalculated(fields, id('td_gate'), gates.td);
  commitCalculated(fields, id('pediatric_pfizer_gate'), gates.pfizer);
  commitCalculated(fields, id('pediatric_pfizer_status'), gates.statusSettled);
  commitCalculated(fields, id('hpv_gate'), gates.hpv);
  commitCalculated(fields, id('hpv_status'), gates.hpvStatus);
  commitUserValue(fields, id('vaccine_name'), vaccine);
  if (route) commitUserValue(fields, id('route'), route);
  if (returnDate) commitUserValue(fields, id('return_date'), returnDate);
}

function payload(fields) {
  ObsAdapter.tearDown();
  return prepareEncounter({
    patient: { id: 'patient-uuid' },
    formJson: { uuid: rawForm.uuid, encounterType: rawForm.encounter },
    domainObjectValue: null,
    formFields: fields,
    visit: null,
    deletedFields: [],
  }, new Date('2026-10-26T10:00:00.000Z'), 'role-uuid', 'provider-uuid', 'location-uuid');
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function describeMember(member, groupId, fields) {
  const path = member.formFieldPath ?? '';
  const id = path.startsWith('rfe-forms-') ? path.slice('rfe-forms-'.length) : path;
  const field = fields.find((item) => item.id === id);
  return {
    id,
    formFieldPath: path,
    concept: member.concept ?? null,
    value: member.value ?? null,
    groupParent: groupId,
    row: /_(\d+)$/.test(id) ? 'clone' : 'original',
    transient: field?.questionOptions?.isTransient === true,
    fieldType: field?.type ?? null,
    fieldConcept: field?.questionOptions?.concept ?? null,
    hasUuid: Object.prototype.hasOwnProperty.call(member, 'uuid'),
    hasVoided: Object.prototype.hasOwnProperty.call(member, 'voided'),
    conceptMissing: !present(member.concept),
    valuePresent: present(member.value),
  };
}

function describePayload(body, fields) {
  return (body.obs ?? []).filter((obs) => obs.formFieldPath?.includes('vaccine_administration')).map((group) => {
    const groupId = group.formFieldPath?.slice('rfe-forms-'.length);
    return {
      id: groupId,
      concept: group.concept ?? null,
      formFieldPath: group.formFieldPath,
      hasUuid: Object.prototype.hasOwnProperty.call(group, 'uuid'),
      hasVoided: Object.prototype.hasOwnProperty.call(group, 'voided'),
      groupMembers: (group.groupMembers ?? []).map((member) => describeMember(member, groupId, fields)),
    };
  });
}

function shared(fields, id) {
  const flat = fields.find((item) => item.id === id);
  const groupId = flat?.meta?.groupId;
  const group = fields.find((item) => item.id === groupId);
  const nested = group?.questions?.find((item) => item.id === id);
  return flat === nested;
}

const emptyGates = await gateValue('');
const bcgGates = await gateValue(bcg);
const opvGates = await gateValue(opv1);

function buildSingle() {
  const fields = freshFields();
  settleRow(fields, '', bcg, oral, '2026-11-02', bcgGates);
  return { fields, body: payload(fields) };
}

function buildMany(rows, { blankOptional = false } = {}) {
  const fields = freshFields();
  rows.forEach((row, index) => {
    const suffix = index === 0 ? '' : index;
    if (index > 0) {
      addRepeat(fields, suffix, {
        [`td_gate_${suffix}`]: emptyGates.td,
        [`pediatric_pfizer_gate_${suffix}`]: emptyGates.pfizer,
        [`pediatric_pfizer_status_${suffix}`]: emptyGates.statusNow,
        [`hpv_gate_${suffix}`]: emptyGates.hpv,
        [`hpv_status_${suffix}`]: emptyGates.hpvStatus,
      });
    }
    const route = blankOptional && index > 0 ? '' : oral;
    const returnDate = blankOptional && index > 0 ? '' : row.returnDate;
    settleRow(fields, suffix, row.vaccine, route, returnDate, row.vaccine === bcg ? bcgGates : opvGates);
  });
  return { fields, body: payload(fields) };
}

const single = buildSingle();
const two = buildMany([
  { vaccine: bcg, returnDate: '2026-11-02' },
  { vaccine: opv1, returnDate: '2026-12-01' },
]);
const three = buildMany([
  { vaccine: bcg, returnDate: '2026-11-02' },
  { vaccine: opv1, returnDate: '2026-12-01' },
  { vaccine: opv0, returnDate: '2027-01-04' },
]);
const blank = buildMany([
  { vaccine: bcg, returnDate: '2026-11-02' },
  { vaccine: opv1, returnDate: '' },
], { blankOptional: true });

function buildChecking() {
  const fields = freshFields();
  settleRow(fields, '', bcg, oral, '2026-11-02', bcgGates);
  addRepeat(fields, 1, {
    td_gate_1: emptyGates.td,
    pediatric_pfizer_gate_1: emptyGates.pfizer,
    pediatric_pfizer_status_1: emptyGates.statusNow,
    hpv_gate_1: emptyGates.hpv,
    hpv_status_1: emptyGates.hpvStatus,
  });
  commitUserValue(fields, 'vaccine_name_1', opv1);
  commitUserValue(fields, 'route_1', oral);
  commitUserValue(fields, 'return_date_1', '2026-12-01');
  commitCalculated(fields, 'td_gate_1', opvGates.td);
  commitCalculated(fields, 'pediatric_pfizer_gate_1', opvGates.pfizer);
  commitCalculated(fields, 'pediatric_pfizer_status_1', emptyGates.statusNow);
  commitCalculated(fields, 'hpv_gate_1', opvGates.hpv);
  commitCalculated(fields, 'hpv_status_1', emptyGates.hpvStatus);
  return { fields, body: payload(fields) };
}

const checking = buildChecking();

function metaOf(fields, id) {
  const field = fieldById(fields, id);
  return {
    id,
    type: field.type,
    transient: field.questionOptions?.isTransient === true,
    concept: field.questionOptions?.concept ?? null,
    groupId: field.meta?.groupId ?? null,
    submissionConcept: field.meta?.submission?.newValue?.concept ?? null,
    submissionValue: field.meta?.submission?.newValue?.value ?? null,
    sharedWithGroupQuestions: shared(fields, id),
  };
}

const comparisonIds = [
  'vaccine_administration', 'vaccine_name', 'route', 'return_date', 'td_gate', 'pediatric_pfizer_gate', 'pediatric_pfizer_status', 'hpv_gate', 'hpv_status', 'already_captured_gate',
  'vaccine_administration_1', 'vaccine_name_1', 'route_1', 'return_date_1', 'td_gate_1', 'pediatric_pfizer_gate_1', 'pediatric_pfizer_status_1', 'hpv_gate_1', 'hpv_status_1', 'already_captured_gate_1',
];

process.stdout.write(`${JSON.stringify({
  version,
  formVersion: rawForm.version,
  gates: { empty: emptyGates, bcg: bcgGates, opv: opvGates },
  concepts: {
    group: properties.get('var.concept.national.vaccine-administration.uuid'),
    vaccine: properties.get('var.concept.national.vaccine-name.uuid'),
    route: properties.get('var.concept.national.route.uuid'),
    returnDate: properties.get('var.concept.national.return-date-for-the-next-vaccination.uuid'),
    bcg,
    opv1,
    opv0,
    oral,
  },
  comparison: Object.fromEntries(comparisonIds.map((id) => [id, metaOf(two.fields, id)])),
  single: describePayload(single.body, single.fields),
  two: describePayload(two.body, two.fields),
  three: describePayload(three.body, three.fields),
  blank: describePayload(blank.body, blank.fields),
  checking: describePayload(checking.body, checking.fields),
})}\n`);
