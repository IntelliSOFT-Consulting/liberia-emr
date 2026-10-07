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
import { getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { createHomeDashboardLink } from './home-dashboard/home-dashboard-link.component';
import { RESOLVE_SYNC_CONFLICTS, SYNC_CONFLICTS_DASHBOARD, SYNC_STATUS_DASHBOARD, VIEW_SYNC_STATUS } from './privileges';

const moduleName = '@liberiaemr/esm-liberia-sync-status-app';

const options = { featureName: 'liberia-sync-status', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export const root = getAsyncLifecycle(() => import('./sync-status/sync-status.component'), options);

// Reviewing sync conflicts, reached from the status page's conflicts tile.
export const syncConflicts = getAsyncLifecycle(() => import('./sync-conflicts/sync-conflicts.component'), options);

// Reviewing possible identity matches at central (ADR 0005), reached from the status page's tile.
export const identityReview = getAsyncLifecycle(() => import('./identity-review/identity-review.component'), options);

// The Master Facility List sync (ADR 0009 decision 9). It hides itself where no MFL account is set.
export const mflSync = getAsyncLifecycle(() => import('./mfl-sync/mfl-sync.component'), options);

export const mflSyncAppMenuItem = getAsyncLifecycle(
  () => import('./mfl-sync/mfl-sync-app-menu-item.component'),
  options,
);

export const syncStatusAppMenuItem = getAsyncLifecycle(
  () => import('./sync-status/sync-status-app-menu-item.component'),
  options,
);

// Home page dashboards, the same pages as /sync-status and /sync-conflicts. config-national.json
// lands the Sync Administrator on the first and the Sync Conflict Reviewer on the second
// (esm-home-app's defaultDashboardPerRole).
export const syncStatusDashboardLink = getSyncLifecycle(
  // t('syncStatus', 'Sync status')
  createHomeDashboardLink({
    name: SYNC_STATUS_DASHBOARD,
    titleKey: 'syncStatus',
    title: 'Sync status',
    privilege: VIEW_SYNC_STATUS,
  }),
  options,
);

export const syncConflictsDashboardLink = getSyncLifecycle(
  // t('syncConflicts', 'Sync conflicts')
  createHomeDashboardLink({
    name: SYNC_CONFLICTS_DASHBOARD,
    titleKey: 'syncConflicts',
    title: 'Sync conflicts',
    privilege: RESOLVE_SYNC_CONFLICTS,
  }),
  options,
);
