/**
 * @liberiaemr/esm-liberia-patient-chart-extension
 *
 * A generic, fully configurable "Observations by Encounter" widget for the
 * LiberiaEMR O3 patient chart. All clinical content (concepts, encounter types,
 * the AMPATH form to launch) is supplied at runtime via content-package JSON
 * config — the package itself contains no programme-specific defaults.
 *
 * First consumer: TB Screening (content-liberia-national).
 * Also hosts globally loaded form-engine expression helpers (current-pregnancy
 * ANC numeric lookup for L&D Gravida/Parity prefill, Td pregnancy eligibility,
 * the transient WHO weight-for-length/height display, the MUAC completed-month
 * check, and Vitamin A supplementation age, history and return-date checks).
 * Planned consumers: Partograph obs summary, ANC summary.
 */
import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { routineConfigSchema } from './immunizations/routine-config';
import { configSchema } from './config-schema';
import { currentPregnancyAncConfigSchema } from './forms/current-pregnancy-anc-config-schema';
import { externalRecordsConfigSchema } from './external-records/external-records-config';
import { getCurrentPregnancyAncNumeric } from './forms/current-pregnancy-anc-obstetric-history';
import { registerFormEngineExpressionHelper } from './forms/register-form-engine-helpers';
import { calcLiberiaWhz, isMuacRequired } from './forms/who-whz';
import { loadVitaminAAdministrations } from './forms/vitamin-a-history';
import { vitaminAEditingEncounterUuid } from './forms/vitamin-a-session';
import {
  vitaminABlock,
  vitaminACurrentStrength,
  vitaminAReturnDateValue,
  vitaminARouteRejected,
  vitaminARouteValue,
  vitaminASharedReturnValue,
} from './forms/vitamin-a-supplementation';
import { tdAdministrationGate } from './immunizations/td-administration-gate';
import { isTdVaccine } from './immunizations/td-pregnancy';

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';

const options = {
  featureName: 'liberia-patient-chart-extension',
  moduleName,
};

export function startupApp() {
  defineConfigSchema('liberia-obs-widget', configSchema);
  defineConfigSchema('liberia-immunization-history', configSchema);
  defineConfigSchema(moduleName, {
    ...currentPregnancyAncConfigSchema,
    routineImmunizations: routineConfigSchema,
    externalRecords: externalRecordsConfigSchema,
  });
  registerFormEngineExpressionHelper('getCurrentPregnancyAncNumeric', getCurrentPregnancyAncNumeric);
  registerFormEngineExpressionHelper('calcLiberiaWhz', calcLiberiaWhz);
  registerFormEngineExpressionHelper('isMuacRequired', isMuacRequired);
  registerFormEngineExpressionHelper('tdAdministrationGate', tdAdministrationGate);
  registerFormEngineExpressionHelper('isTdVaccine', isTdVaccine);
  registerFormEngineExpressionHelper('vitaminACurrentStrength', vitaminACurrentStrength);
  registerFormEngineExpressionHelper('vitaminABlock', vitaminABlock);
  registerFormEngineExpressionHelper('vitaminAReturnDateValue', vitaminAReturnDateValue);
  registerFormEngineExpressionHelper('vitaminASharedReturnValue', vitaminASharedReturnValue);
  registerFormEngineExpressionHelper('vitaminARouteValue', vitaminARouteValue);
  registerFormEngineExpressionHelper('vitaminARouteRejected', vitaminARouteRejected);
  registerFormEngineExpressionHelper('vitaminAEditingEncounterUuid', vitaminAEditingEncounterUuid);
  registerFormEngineExpressionHelper('loadVitaminAAdministrations', loadVitaminAAdministrations);
}

/**
 * Generic obs-by-encounter widget. Renders a configurable Carbon DataTable
 * (columns = encounters, rows = configured concepts) with an "Add" button that
 * opens the configured AMPATH form in the standard patient-form-entry-workspace.
 *
 * Display mode (table / graph / switchable) is controlled
 * by runtime config — no rebuild needed to switch between them.
 */
export const liberiaObsWidget = getAsyncLifecycle(
  () => import('./liberia-obs-widget/liberia-obs-widget.component'),
  {
    featureName: 'liberia-obs-widget',
    moduleName: 'liberia-obs-widget',
  },
);

/** Immunization history through REST encounters, so module read can authorize it without Get Encounters. */
export const liberiaImmunizationHistory = getAsyncLifecycle(
  () => import('./liberia-obs-widget/liberia-obs-widget.component'),
  {
    featureName: 'liberia-immunization-history',
    moduleName: 'liberia-immunization-history',
  },
);

// External records (LE-386): another facility's history for an imported patient, read-only.
export const externalRecordsSummary = getAsyncLifecycle(
  () => import('./external-records/external-records-summary.extension'),
  options,
);

export const externalRecordsBannerTag = getAsyncLifecycle(
  () => import('./external-records/external-records-banner-tag.extension'),
  options,
);

export const externalRecordsDashboardLink = getAsyncLifecycle(
  () => import('./external-records/external-records-dashboard-link.extension'),
  options,
);

export const externalRecordsDashboard = getAsyncLifecycle(
  () => import('./external-records/external-records-dashboard.extension'),
  options,
);
