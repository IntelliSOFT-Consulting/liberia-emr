import routes from './routes.json';

/**
 * The privileges that show this app's menu entries and home page dashboards, each the one its
 * endpoint requires (modules/liberiaemr: SyncStatusController, MflSyncController,
 * SyncConflictController), from content-liberia-national's roles.
 *
 * routes.json is the one place they are written. The app shell reads them there to decide whether
 * to mount an entry, and cannot read the frontend config, so the components read them from the
 * same file. An entry the shell leaves out never sends its request, so a user without the
 * privilege sees no 403 from opening the app menu.
 */
type Extension = { name: string; privileges?: Array<string>; meta?: { name: string } };

const extension = (name: string) =>
  (routes.extensions as Array<Extension>).find((candidate) => candidate.name === name);

/** View Sync Status: the sync status page. Sync Administrator and Sync Conflict Reviewer. */
export const VIEW_SYNC_STATUS: string = extension('sync-status-app-menu-item').privileges[0];

/** View MFL Sync: the Master Facility List sync page. Sync Administrator. */
export const VIEW_MFL_SYNC: string = extension('mfl-sync-app-menu-item').privileges[0];

/** Resolve Sync Conflicts: the sync conflicts page. Sync Conflict Reviewer. */
export const RESOLVE_SYNC_CONFLICTS: string = extension('sync-conflicts-dashboard-link').privileges[0];

/**
 * The home page dashboards (/home/<name>). config-national.json maps the Sync Administrator to the
 * first and the Sync Conflict Reviewer to the second in esm-home-app's defaultDashboardPerRole.
 */
export const SYNC_STATUS_DASHBOARD: string = extension('sync-status-dashboard-link').meta.name;
export const SYNC_CONFLICTS_DASHBOARD: string = extension('sync-conflicts-dashboard-link').meta.name;
