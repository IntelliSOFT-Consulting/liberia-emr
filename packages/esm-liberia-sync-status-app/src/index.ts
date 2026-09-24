/**
 * @liberiaemr/esm-liberia-sync-status-app
 *
 * CUSTOM BUILD (IMPLEMENTATION.md section 3). A national view of facility to central sync,
 * so MOH staff can see which facilities are sending and what is waiting at central without
 * a terminal. Nothing clinical: counts, facility codes and dates only.
 *
 * The page and its menu item hide themselves unless the backend reports the feature on, so
 * the same frontend image serves a facility, where there is no national view to show.
 */
import { getAsyncLifecycle } from '@openmrs/esm-framework';

const moduleName = '@liberiaemr/esm-liberia-sync-status-app';

const options = { featureName: 'liberia-sync-status', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export const root = getAsyncLifecycle(() => import('./sync-status/sync-status.component'), options);

// Reviewing sync conflicts, reached from the status page's conflicts tile.
export const syncConflicts = getAsyncLifecycle(() => import('./sync-conflicts/sync-conflicts.component'), options);

export const syncStatusAppMenuItem = getAsyncLifecycle(
  () => import('./sync-status/sync-status-app-menu-item.component'),
  options,
);
