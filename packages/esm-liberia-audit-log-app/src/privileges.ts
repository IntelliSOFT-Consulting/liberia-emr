import routes from './routes.json';

/**
 * The privilege that shows the audit log's menu entry: View Audit Log, which content-liberia-national
 * gives the ICT Auditor role only.
 *
 * routes.json is the one place it is written. The app shell reads it there to decide whether to
 * mount the menu entry, and cannot read the frontend config, so the menu item reads it from the
 * same file rather than from a config key that could drift from it.
 *
 * The server does not rely on it: every audit log call needs Get Audit Logs, the auditlog module's
 * own privilege (READ_PRIVILEGE), which the same role holds. A user who reaches the page by its
 * URL without it gets the server's 403, and the page says which role to ask for.
 */
export const VIEW_PRIVILEGE: string = routes.extensions.find(
  (extension) => extension.name === 'audit-log-app-menu-item',
).privileges[0];

export const READ_PRIVILEGE = 'Get Audit Logs';

/**
 * The home page dashboard's name (/home/audit-log), from its link in routes.json. The ICT Auditor
 * lands on it: config-national.json maps the role to it in esm-home-app's defaultDashboardPerRole.
 */
export const AUDIT_LOG_DASHBOARD: string = (
  routes.extensions.find((extension) => extension.name === 'audit-log-dashboard-link') as { meta: { name: string } }
).meta.name;
