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
 * ANC numeric lookup for L&D Gravida/Parity prefill).
 * Planned consumers: Partograph obs summary, ANC summary.
 */
import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { currentPregnancyAncConfigSchema } from './forms/current-pregnancy-anc-config-schema';
import { getCurrentPregnancyAncNumeric } from './forms/current-pregnancy-anc-obstetric-history';
import { registerFormEngineExpressionHelper } from './forms/register-form-engine-helpers';

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';

const options = {
  featureName: 'liberia-patient-chart-extension',
  moduleName,
};

export function startupApp() {
  defineConfigSchema('liberia-obs-widget', configSchema);
  defineConfigSchema(moduleName, currentPregnancyAncConfigSchema);
  registerFormEngineExpressionHelper('getCurrentPregnancyAncNumeric', getCurrentPregnancyAncNumeric);
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
