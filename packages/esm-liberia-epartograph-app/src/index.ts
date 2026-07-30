/**
 * @liberiaemr/esm-liberia-epartograph-app
 *
 * CUSTOM BUILD (IMPLEMENTATION.md §3). There is no community e-partograph, so this is a
 * greenfield O3 frontend module — not a patch of anything upstream, and not smuggled
 * inside a content package. It is versioned independently and pinned in
 * distribution/distro.properties like any other ESM.
 *
 * Clinical concepts and the WHO alert/action line parameters are NOT compiled in. They
 * come from runtime configuration supplied by content-liberia-mch, so a concept
 * correction ships as a config change rather than a frontend release.
 */
import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@liberiaemr/esm-liberia-epartograph-app';

const options = {
  featureName: 'liberia-epartograph',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

/**
 * Rendered in the patient chart for a patient with an open Maternity visit.
 * STUB — the chart itself is the highest-risk clinical component in the project and is
 * not implemented yet. See docs/metadata-specs/mch.md and the DAK before building it.
 */
export const partographChart = getAsyncLifecycle(
  () => import('./partograph/partograph-chart.component'),
  options,
);

export const partographDashboardLink = getAsyncLifecycle(
  () => import('./partograph/partograph-dashboard-link.component'),
  options,
);
