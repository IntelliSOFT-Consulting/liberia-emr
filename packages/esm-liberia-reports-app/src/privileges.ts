import routes from './routes.json';

/**
 * The privilege that opens the indicator reports: the menu entry and the page.
 *
 * routes.json is the one place it is written. The app shell reads it there to decide whether to
 * mount the menu entry, and cannot read the frontend config, so the components read it from the
 * same file rather than from a config key that could drift from it. The reports module enforces
 * the same privilege on the server, where it is a constant too.
 */
export const EXPORT_PRIVILEGE: string = routes.extensions.find(
  (extension) => extension.name === 'indicator-reports-app-menu-item',
).privileges[0];

/**
 * The home page dashboard's name (/home/indicator-reports), from its link in routes.json. The
 * National Reporting Officer lands on it: config-national.json maps the role to it in
 * esm-home-app's defaultDashboardPerRole.
 */
export const REPORTS_DASHBOARD: string = (
  routes.extensions.find((extension) => extension.name === 'indicator-reports-dashboard-link') as {
    meta: { name: string };
  }
).meta.name;
