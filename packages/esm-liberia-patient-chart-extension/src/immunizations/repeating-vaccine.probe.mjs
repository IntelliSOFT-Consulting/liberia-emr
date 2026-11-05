import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const libPackage = require.resolve('@openmrs/esm-form-engine-lib/package.json');
const version = JSON.parse(readFileSync(libPackage, 'utf8')).version;

const { cloneRepeatField, updateFieldIdInExpression, disableRepeatAddButton } = await import(
  '@openmrs/esm-form-engine-lib/dist/components/repeat/helpers.js'
);
const { constructObs, ObsAdapter } = await import('@openmrs/esm-form-engine-lib/dist/adapters/obs-adapter.js');
const { clearSubmission } = await import('@openmrs/esm-form-engine-lib/dist/utils/common-utils.js');
const { validateForm } = await import('@openmrs/esm-form-engine-lib/dist/provider/form-factory-helper.js');
const { hydrateRepeatField } = await import(
  '@openmrs/esm-form-engine-lib/dist/processors/encounter/encounter-processor-helper.js'
);
const { DefaultFormSchemaTransformer } = await import(
  '@openmrs/esm-form-engine-lib/dist/transformers/default-schema-transformer.js'
);
const { formStateReducer } = await import(
  '@openmrs/esm-form-engine-lib/dist/components/renderer/form/state.js'
);

const form = JSON.parse(readFileSync(resolve(
  packageRoot,
  '../../content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
), 'utf8'));
const transformed = DefaultFormSchemaTransformer.transform(structuredClone(form));
const group = transformed.pages
  .flatMap((page) => page.sections)
  .flatMap((section) => section.questions)
  .find((question) => question.id === 'vaccine_administration');

const clone = cloneRepeatField(group, null, 1);
const child = (id) => clone.questions.find((question) => question.id === id);

const laterSibling = {
  id: 'vaccine_administration',
  type: 'obsGroup',
  meta: {},
  questionOptions: { concept: 'group', rendering: 'repeating', repeatOptions: { addText: 'Add Another Vaccine' } },
  questions: [
    {
      id: 'vaccine_name',
      type: 'obs',
      meta: {},
      questionOptions: { concept: 'vaccine', rendering: 'select', calculate: { calculateExpression: 'vaccine_name' } },
      validators: [],
    },
    {
      id: 'route',
      type: 'obs',
      meta: {},
      questionOptions: { concept: 'route', rendering: 'select', calculate: { calculateExpression: 'routeFrom(vaccine_name, return_date)' } },
      validators: [{ type: 'js_expression', failsWhenExpression: 'return_date === vaccine_name' }],
    },
    {
      id: 'return_date',
      type: 'obs',
      meta: {},
      questionOptions: { concept: 'return', rendering: 'date' },
      validators: [],
    },
  ],
};
const leaked = cloneRepeatField(laterSibling, null, 1).questions.find((question) => question.id === 'route_1');

// constructObs here skips isTransient, so it never shows the live encounter body.
// prepareEncounter reads meta.submission, and processObsGroup does not skip
// transient members. repeating-vaccine-submission.probe.mjs covers that path.
function submit(field, values) {
  const obsGroup = constructObs(field, null);
  for (const nested of field.questions ?? []) {
    if (nested.questionOptions?.isTransient) continue;
    const value = values[nested.id];
    if (value === undefined || value === null || value === '') continue;
    const member = constructObs(nested, value);
    if (member) obsGroup.groupMembers.push(member);
  }
  return obsGroup.groupMembers.length ? obsGroup : null;
}

const bcg = 'bcg-concept';
const opv = 'opv0-concept';
const intradermal = 'intradermal-concept';
const oral = 'oral-concept';
const one = submit(group, { vaccine_name: bcg, route: intradermal, return_date: '2024-02-28' });
const second = cloneRepeatField(group, null, 1);
const two = submit(second, { vaccine_name_1: opv, route_1: oral, return_date_1: '2024-03-13' });
const empty = submit(group, {});

const groupConcept = 'group-concept';
const vaccineConcept = 'vaccine-concept';
const routeConcept = 'route-concept';
ObsAdapter.tearDown();
const template = {
  id: 'vaccine_administration',
  type: 'obsGroup',
  meta: { initialValue: { omrsObject: { uuid: 'group-1' } } },
  questionOptions: { concept: groupConcept, rendering: 'repeating' },
  questions: [
    { id: 'vaccine_name', type: 'obs', meta: {}, questionOptions: { concept: vaccineConcept, rendering: 'select' }, validators: [] },
    { id: 'route', type: 'obs', meta: {}, questionOptions: { concept: routeConcept, rendering: 'select' }, validators: [] },
  ],
};
const initialValues = {};
const hydrated = await hydrateRepeatField(template, {
  obs: [
    {
      uuid: 'group-1',
      concept: { uuid: groupConcept },
      groupMembers: [
        { uuid: 'saved-bcg', concept: { uuid: vaccineConcept }, value: { uuid: bcg }, formFieldPath: 'rfe-forms-vaccine_name' },
      ],
    },
    {
      uuid: 'group-2',
      concept: { uuid: groupConcept },
      formFieldPath: 'rfe-forms-vaccine_administration_1',
      groupMembers: [
        { uuid: 'saved-opv', concept: { uuid: vaccineConcept }, value: { uuid: opv }, formFieldPath: 'rfe-forms-vaccine_name_1' },
        { uuid: 'saved-oral', concept: { uuid: routeConcept }, value: { uuid: oral }, formFieldPath: 'rfe-forms-route_1' },
      ],
    },
    {
      uuid: 'group-3',
      concept: { uuid: groupConcept },
      groupMembers: [
        { uuid: 'saved-bcg-again', concept: { uuid: vaccineConcept }, value: { uuid: bcg } },
      ],
    },
  ],
  orders: [],
  diagnoses: [],
}, initialValues, { formFieldAdapters: { obsGroup: ObsAdapter } });

const values = { vaccine_name: bcg, route: intradermal, vaccine_name_1: '', route_1: '' };
const fields = [
  {
    id: 'route',
    isHidden: false,
    meta: { submission: { newValue: intradermal } },
    validators: [{ type: 'reject-blank-row-2' }],
  },
  {
    id: 'route_1',
    isHidden: false,
    meta: { submission: { newValue: '' } },
    validators: [{ type: 'reject-blank-row-2' }],
  },
];
const valid = validateForm({
  formFields: fields,
  formFieldValidators: {
    'reject-blank-row-2': {
      validate(field, value) {
        if (field.id === 'route_1' && value === '') {
          return [{ resultType: 'error', errCode: 'value.invalid', message: 'Select a route for this vaccine' }];
        }
        return [];
      },
    },
  },
  patient: { id: 'patient' },
  sessionMode: 'enter',
  addInvalidField() {},
  updateFormField() {},
  methods: { getValues: () => values, trigger() {} },
});

const kept = { id: 'route', meta: { submission: { newValue: intradermal, voidedValue: null } } };
const removed = { id: 'route_1', meta: { submission: { newValue: oral, voidedValue: null } } };
clearSubmission(removed);

function flattenLikeInitialForm(groupField) {
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
  processField(groupField);
  return flattened;
}

function vaccineGroup(id, obsUuid) {
  return {
    id,
    type: 'obsGroup',
    meta: {
      initialValue: { omrsObject: obsUuid ? { uuid: obsUuid } : null },
      submission: null,
    },
    questionOptions: {
      concept: 'group-concept',
      rendering: 'repeating',
      repeatOptions: { addText: 'Add Another Vaccine' },
    },
    questions: [{
      id: 'vaccine_name',
      type: 'obs',
      meta: { initialValue: { omrsObject: obsUuid ? { uuid: `${obsUuid}-name` } : null }, submission: null },
      questionOptions: { concept: 'vaccine-concept', rendering: 'select' },
      validators: [],
    }],
  };
}

function persistedRemove(state, group) {
  ObsAdapter.transformFieldValue(group, null, {});
  group.meta.repeat = { ...(group.meta.repeat || {}), wasDeleted: true };
  for (const child of group.questions ?? []) {
    child.meta.repeat = { ...(group.meta.repeat || {}), wasDeleted: true };
    ObsAdapter.transformFieldValue(child, null, {});
  }
  let next = formStateReducer(state, { type: 'SET_DELETED_FIELDS', value: [...state.deletedFields, group] });
  next = formStateReducer(next, { type: 'REMOVE_FORM_FIELD', value: group.id });
  return next;
}

function fieldSnapshot(state) {
  return state.formFields.map((field) => ({
    id: field.id,
    meta: {
      groupId: field.meta?.groupId,
      repeat: field.meta?.repeat?.wasDeleted ? { wasDeleted: true } : undefined,
    },
  }));
}

function hydratedBcgOpv() {
  const template = vaccineGroup('vaccine_administration', 'group-bcg');
  const opv = cloneRepeatField(template, { uuid: 'group-opv' }, 1);
  opv.questions[0].meta.initialValue = { omrsObject: { uuid: 'obs-opv' }, refinedValue: null };
  let state = { formFields: [], invalidFields: [], formJson: null, deletedFields: [] };
  for (const field of [...flattenLikeInitialForm(template), opv, ...opv.questions]) {
    state = formStateReducer(state, { type: 'ADD_FORM_FIELD', value: field });
  }
  return { template, opv, state };
}

const readded = hydratedBcgOpv();
const readdedValues = { vaccine_name: 'bcg', vaccine_name_1: 'opv0' };
const removedBcg = persistedRemove(readded.state, readded.template);
const added = cloneRepeatField(vaccineGroup('vaccine_administration', null), null, 2);
for (const field of [added, ...added.questions]) {
  removedBcg.formFields = formStateReducer(removedBcg, { type: 'ADD_FORM_FIELD', value: field }).formFields;
}
readdedValues.vaccine_name_2 = 'bcg';
const templateChild = removedBcg.formFields.find((field) => field.id === 'vaccine_name');

const removedOpv = hydratedBcgOpv();
const opvValues = { vaccine_name: 'bcg', vaccine_name_1: 'opv0' };
const afterOpvRemoval = persistedRemove(removedOpv.state, removedOpv.opv);

const unsavedTemplate = vaccineGroup('vaccine_administration', null);
unsavedTemplate.meta.initialValue.omrsObject = null;
unsavedTemplate.questions[0].meta.initialValue.omrsObject = null;
const unsavedDuplicate = cloneRepeatField(unsavedTemplate, null, 1);
unsavedDuplicate.meta.initialValue.omrsObject = null;
let unsavedState = { formFields: [], invalidFields: [], formJson: null, deletedFields: [] };
for (const field of [...flattenLikeInitialForm(unsavedTemplate), unsavedDuplicate, ...unsavedDuplicate.questions]) {
  unsavedState = formStateReducer(unsavedState, { type: 'ADD_FORM_FIELD', value: field });
}
clearSubmission(unsavedDuplicate);
for (const child of unsavedDuplicate.questions) clearSubmission(child);
unsavedState = formStateReducer(unsavedState, { type: 'REMOVE_FORM_FIELD', value: unsavedDuplicate.id });
const unsavedValues = { vaccine_name: 'bcg' };

const deletion = {
  staleVaccineName: readdedValues.vaccine_name,
  templateChildWasDeleted: templateChild?.meta?.repeat?.wasDeleted === true,
  groupStillPresent: removedBcg.formFields.some((field) => field.id === 'vaccine_administration'),
  groupVoided: Boolean(readded.template.meta.submission?.voidedValue),
  readd: { values: readdedValues, fields: fieldSnapshot(removedBcg) },
  removeOpv: { values: opvValues, fields: fieldSnapshot(afterOpvRemoval) },
  unsaved: { values: unsavedValues, fields: fieldSnapshot(unsavedState) },
};

const processorSource = readFileSync(resolve(
  packageRoot,
  'node_modules/@openmrs/esm-form-engine-lib/dist/processors/encounter/encounter-processor-helper.js',
), 'utf8');
const repeatSource = readFileSync(resolve(
  packageRoot,
  'node_modules/@openmrs/esm-form-engine-lib/dist/components/repeat/repeat.component.js',
), 'utf8');
const controlsSource = readFileSync(resolve(
  packageRoot,
  'node_modules/@openmrs/esm-form-engine-lib/dist/components/repeat/repeat-controls.component.js',
), 'utf8');

const describeChild = (question) => ({
  id: question.id,
  transient: question.questionOptions?.isTransient === true,
  calculate: question.questionOptions?.calculate?.calculateExpression ?? '',
  hide: question.hide?.hideWhenExpression ?? '',
  validators: (question.validators ?? [])
    .filter((validator) => validator.type === 'js_expression')
    .map((validator) => validator.failsWhenExpression ?? ''),
});

process.stdout.write(`${JSON.stringify({
  version,
  rendering: group.questionOptions.rendering,
  addText: group.questionOptions.repeatOptions.addText,
  childIds: group.questions.map((question) => question.id),
  cloneId: clone.id,
  cloneChildren: clone.questions.map(describeChild),
  forwardReference: leaked.questionOptions.calculate.calculateExpression,
  forwardValidator: leaked.validators[0].failsWhenExpression,
  rewrittenSample: updateFieldIdInExpression('isTdVaccine(vaccine_name) && td_gate === "x"', 1, ['vaccine_name', 'td_gate']),
  one,
  two,
  empty,
  hydratedIds: hydrated.map((field) => field.id),
  initialValues,
  valid,
  row1Value: values.vaccine_name,
  row1Route: values.route,
  row1Errors: fields[0].meta.submission.errors ?? null,
  row2Errors: fields[1].meta.submission.errors ?? null,
  keptValue: kept.meta.submission.newValue,
  removedValue: removed.meta.submission.newValue,
  deletion,
  addDisabledAtLimit: disableRepeatAddButton('2', 2),
  addEnabledBelowLimit: disableRepeatAddButton('2', 1),
  source: {
    emptyGroupOmitted: processorSource.includes('obsGroup.groupMembers?.length || obsGroup.voided'),
    constructGroup: processorSource.includes('constructObs(groupField, null)'),
    hydrateClones: processorSource.includes('cloneRepeatField(field, group, counter++)'),
    unregisterRow: repeatSource.includes('unregister(field.id)') && repeatSource.includes('unregister(child.id)'),
    firstRowStays: controlsSource.includes('questionIndex > 0'),
    addText: controlsSource.includes('repeatOptions?.addText'),
  },
})}\n`);
