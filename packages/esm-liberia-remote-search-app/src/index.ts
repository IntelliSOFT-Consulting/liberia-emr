import { defineConfigSchema, getAsyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

export const moduleName = '@liberiaemr/esm-liberia-remote-search-app';

const options = {
  featureName: 'remote-search',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /\.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const remoteSearchResults = getAsyncLifecycle(
  () => import('./remote-search/remote-search-results.component'),
  options,
);

export const remoteSearchToggle = getAsyncLifecycle(
  () => import('./remote-search/remote-search-toggle.component'),
  options,
);

export const remoteSearchSummary = getAsyncLifecycle(
  () => import('./remote-search/remote-search-summary.component'),
  options,
);
