import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const repoRoot = resolve(packageRoot, '../..');
const version = JSON.parse(readFileSync(require.resolve('@openmrs/esm-form-engine-lib/package.json'), 'utf8')).version;

const { getFieldControlWithFallback, getRegisteredControl } = await import(
  '@openmrs/esm-form-engine-lib/dist/registry/registry.js'
);
const { ControlAdapter } = await import('@openmrs/esm-form-engine-lib/dist/adapters/control-adapter.js');
const { ObsAdapter } = await import('@openmrs/esm-form-engine-lib/dist/adapters/obs-adapter.js');
const { prepareEncounter } = await import(
  '@openmrs/esm-form-engine-lib/dist/processors/encounter/encounter-processor-helper.js'
);
const { DefaultFormSchemaTransformer } = await import(
  '@openmrs/esm-form-engine-lib/dist/transformers/default-schema-transformer.js'
);
const { evaluateAsyncExpression } = await import(
  '@openmrs/esm-form-engine-lib/dist/utils/expression-runner.js'
);
const { ExpressionValidator } = await import(
  '@openmrs/esm-form-engine-lib/dist/validators/js-expression-validator.js'
);
const { FormProvider } = await import('@openmrs/esm-form-engine-lib/dist/provider/form-provider.js');

const patient = { id: 'patient-uuid', sex: 'F', age: 30, birthDate: '1996-01-01' };
const expressionContext = { mode: 'enter', patient, visit: {} };
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

function variables() {
  const declared = new Map();
  const packages = join(repoRoot, 'content-packages');
  for (const pkg of readdirSync(packages)) {
    let text = '';
    try {
      text = readFileSync(join(packages, pkg, 'configuration', 'variables.properties'), 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of propertiesOf(text)) {
      declared.set(key, value);
    }
  }
  return declared;
}

const vars = variables();

function substitute(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (token, name) => vars.get(name) ?? token);
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]));
  }
  return value;
}

function walk(questions, found = []) {
  for (const question of questions ?? []) {
    found.push(question);
    walk(question.questions, found);
  }
  return found;
}

function loadFields(file) {
  const raw = substitute(JSON.parse(readFileSync(join(repoRoot, file), 'utf8')));
  const form = DefaultFormSchemaTransformer.transform(structuredClone(raw));
  const fields = walk(form.pages.flatMap((page) => page.sections ?? []).flatMap((section) => section.questions ?? []));
  const byId = (id) => {
    const field = fields.find((item) => item.id === id);
    if (!field) throw new Error(`${raw.name} is missing ${id}`);
    return field;
  };
  return {
    name: raw.name,
    version: raw.version,
    uuid: raw.uuid,
    encounter: raw.encounter,
    unit: byId('rbsUnit'),
    mg: byId('rbsMgdl'),
    mmol: byId('rbsMmol'),
  };
}

function renderField(Component, field, value) {
  const selected = [];
  globalThis.__rbsUi = [];
  renderToStaticMarkup(React.createElement(
    FormProvider,
    {
      methods: {},
      sessionMode: 'enter',
      layoutType: 'small-desktop',
      workspaceLayout: 'minimized',
      formFieldAdapters: adapters,
    },
    React.createElement(Component, {
      field,
      value,
      errors: [],
      warnings: [],
      setFieldValue: (next) => {
        selected.push(next);
      },
    }),
  ));
  return { ui: globalThis.__rbsUi, selected };
}

async function controlFor(field) {
  const copy = structuredClone(field);
  const component = await getFieldControlWithFallback(copy);
  const text = await getRegisteredControl('text');
  const radio = await getRegisteredControl('radio');
  const number = await getRegisteredControl('number');
  return {
    field: copy,
    component,
    kind: component === text ? 'text' : component === radio ? 'radio' : component === number ? 'number' : 'other',
    disabled: copy.disabled === true,
    isDisabled: copy.isDisabled === true,
  };
}

async function describeBroken(field) {
  const resolved = await controlFor({ ...structuredClone(field), type: 'obs', disabled: undefined, isDisabled: undefined });
  const rendered = renderField(resolved.component, resolved.field, '');
  const text = rendered.ui.find((item) => item.name === 'TextInput');
  const radios = rendered.ui.filter((item) => item.name === 'RadioButton');
  return {
    kind: resolved.kind,
    disabled: resolved.disabled,
    isDisabled: resolved.isDisabled,
    textInputDisabled: text?.disabled === true,
    radioCount: radios.length,
    transient: resolved.field.questionOptions?.isTransient === true,
    concept: resolved.field.questionOptions?.concept ?? null,
  };
}

function clickAnswer(rendered, label) {
  const button = rendered.ui.find((item) => item.name === 'RadioButton' && item.labelText === label);
  if (!button?.onClick) throw new Error(`No clickable radio for ${label}`);
  button.onClick({ target: { checked: false }, preventDefault() {} });
  return rendered.selected.at(-1);
}

async function warmup(fields) {
  for (const field of fields) {
    const node = { value: field, type: 'field' };
    for (const expression of [
      field.hide?.hideWhenExpression,
      field.questionOptions?.calculate?.calculateExpression,
    ]) {
      if (expression) await evaluateAsyncExpression(expression, node, fields, {}, expressionContext);
    }
  }
}

async function recalculate(unit, fields, values) {
  const snapshot = { ...values };
  const order = [...(unit.fieldDependents ?? [])];
  const next = { ...values };
  for (const id of order) {
    const dependent = fields.find((field) => field.id === id);
    const expression = dependent?.questionOptions?.calculate?.calculateExpression;
    if (!expression) continue;
    next[id] = await evaluateAsyncExpression(
      expression,
      { value: dependent, type: 'field' },
      fields,
      snapshot,
      { ...expressionContext, myValue: snapshot[id] },
    );
  }
  return { order, values: next };
}

async function hideOf(field, fields, values) {
  if (!field.hide?.hideWhenExpression) return false;
  return Boolean(await evaluateAsyncExpression(
    field.hide.hideWhenExpression,
    { value: field, type: 'field' },
    fields,
    values,
    { ...expressionContext, myValue: values[field.id] },
  ));
}

function validatorMessages(field, fields, values) {
  return (field.validators ?? [])
    .filter((validator) => validator.type === 'js_expression')
    .flatMap((validator) => ExpressionValidator.validate(field, values[field.id], {
      ...validator,
      formFields: fields,
      values,
      expressionContext: { ...expressionContext },
    }) ?? [])
    .map((result) => result.message);
}

function freshTrio(source) {
  const unit = structuredClone(source.unit);
  const mg = structuredClone(source.mg);
  const mmol = structuredClone(source.mmol);
  unit.type = 'control';
  unit.disabled = undefined;
  unit.isDisabled = undefined;
  return [unit, mg, mmol];
}

function payloadFor(source, fields, values, messages) {
  for (const field of fields) {
    field.isHidden = false;
  }
  const hidden = {};
  return Promise.all(fields.map(async (field) => {
    hidden[field.id] = await hideOf(field, fields, values);
    field.isHidden = hidden[field.id];
    const errors = messages[field.id] ?? validatorMessages(field, fields, values);
    field.meta.submission = { ...(field.meta.submission ?? {}), errors };
    if (!errors.length) adapters[field.type].transformFieldValue(field, values[field.id], {});
  })).then(() => {
    ObsAdapter.tearDown();
    const body = prepareEncounter({
      patient,
      formJson: { uuid: source.uuid, encounterType: source.encounter },
      domainObjectValue: null,
      formFields: fields,
      visit: null,
      deletedFields: [],
    }, new Date('2026-10-27T08:00:00.000Z'), 'role-uuid', 'provider-uuid', 'location-uuid');
    return {
      hidden,
      messages: Object.fromEntries(fields.map((field) => [field.id, messages[field.id] ?? validatorMessages(field, fields, values)])),
      obs: (body.obs ?? []).map((obs) => ({
        concept: obs.concept ?? null,
        value: obs.value ?? null,
        formFieldPath: obs.formFieldPath ?? null,
        voided: obs.voided === true,
      })),
    };
  });
}

async function interact(source) {
  const fields = freshTrio(source);
  const [unit, mg, mmol] = fields;
  await warmup(fields);
  const resolved = await controlFor(unit);
  const rendered = renderField(resolved.component, resolved.field, '');
  const mgConcept = mg.questionOptions.concept;
  const mmolConcept = mmol.questionOptions.concept;
  const selectedMg = clickAnswer(rendered, 'mg/dL');
  const mgValues = { rbsUnit: selectedMg, rbsMgdl: '', rbsMmol: '' };
  const afterMgSelect = await recalculate(unit, fields, mgValues);
  const enteredMg = { ...afterMgSelect.values, rbsMgdl: 105 };
  const mgOnly = await payloadFor(source, freshTrio(source), enteredMg, {});

  const switched = await recalculate(unit, fields, { rbsUnit: mmolConcept, rbsMgdl: 105, rbsMmol: '' });
  const switchFields = freshTrio(source);
  const switchMessages = {
    rbsUnit: [],
    rbsMgdl: validatorMessages(switchFields[1], switchFields, switched.values),
    rbsMmol: validatorMessages(switchFields[2], switchFields, switched.values),
  };
  const switchPayload = await payloadFor(source, switchFields, switched.values, switchMessages);

  const mmolFields = freshTrio(source);
  const mmolValues = { rbsUnit: mmolConcept, rbsMgdl: '', rbsMmol: 5.8 };
  const mmolOnly = await payloadFor(source, mmolFields, mmolValues, {});

  const back = await recalculate(unit, fields, { rbsUnit: mgConcept, rbsMgdl: '', rbsMmol: 5.8 });
  const backFields = freshTrio(source);
  const backMessages = {
    rbsUnit: [],
    rbsMgdl: validatorMessages(backFields[1], backFields, back.values),
    rbsMmol: validatorMessages(backFields[2], backFields, back.values),
  };

  const moved = await recalculate(unit, fields, { rbsUnit: mmolConcept, rbsMgdl: 5, rbsMmol: '' });
  const movedPayload = await payloadFor(source, freshTrio(source), moved.values, {});

  const zero = await payloadFor(source, freshTrio(source), { rbsUnit: mgConcept, rbsMgdl: 0, rbsMmol: '' }, {});
  const upper = await payloadFor(source, freshTrio(source), { rbsUnit: mmolConcept, rbsMgdl: '', rbsMmol: 33.3 }, {});

  const mgHidden = await hideOf(mg, fields, afterMgSelect.values);
  const mmolHidden = await hideOf(mmol, fields, afterMgSelect.values);
  const mgNumber = await controlFor(mg);
  const mmolNumber = await controlFor(mmol);

  return {
    kind: resolved.kind,
    disabled: resolved.disabled,
    isDisabled: resolved.isDisabled,
    transient: unit.questionOptions.isTransient === true,
    persistedConcept: unit.questionOptions.concept ?? null,
    adapterValue: ControlAdapter.transformFieldValue(unit, mgConcept, {}),
    formGroupDisabled: rendered.ui.find((item) => item.name === 'FormGroup')?.disabled === true,
    answers: rendered.ui.filter((item) => item.name === 'RadioButton').map((item) => ({
      label: item.labelText,
      id: item.id,
    })),
    dependentOrder: afterMgSelect.order,
    selectMg: selectedMg,
    selectMmol: clickAnswer(renderField(resolved.component, resolved.field, ''), 'mmol/L'),
    afterMg: { values: afterMgSelect.values, mgHidden, mmolHidden },
    mgControl: mgNumber.kind,
    mmolControl: mmolNumber.kind,
    mgDisabled: mgNumber.isDisabled,
    mmolDisabled: mmolNumber.isDisabled,
    submit105: mgOnly,
    switchToMmol: { values: switched.values, messages: switchMessages, payload: switchPayload },
    submit58: mmolOnly,
    switchToMg: { values: back.values, messages: backMessages },
    movedFive: { values: moved.values, obs: movedPayload.obs },
    submitZero: zero.obs,
    submitUpper: upper.obs,
  };
}

const forms = [
  'content-packages/content-liberia-opd-ipd/configuration/backend_configuration/ampathforms/triage_form.json',
  'content-packages/content-liberia-opd-ipd/configuration/backend_configuration/ampathforms/opd_consultation_form.json',
].map(loadFields);

const report = {
  version,
  forms: [],
};
for (const form of forms) {
  report.forms.push({
    name: form.name,
    version: form.version,
    authoredType: form.unit.type,
    broken: await describeBroken(form.unit),
    fixed: await interact(form),
  });
}

console.log(JSON.stringify(report));
