/**
 * @liberiaemr/esm-liberia-audit-log-app
 *
 * CUSTOM BUILD (IMPLEMENTATION.md section 3). The ICT Unit's audit log viewer, MOH ICT SOP control
 * B3: what was created, changed or deleted on this server, by whom and when, with the previous and
 * current values, and a CSV download. It reads GET /ws/rest/v1/liberiaemr/auditlog, served by
 * modules/liberiaemr from the auditlog module's table.
 *
 * The auditlog module's own page does not load on core 2.8.8 and it has no REST resource, hence
 * this app (docs/security/moh-ict-sop-mapping.md, B3).
 */
import { defineConfigSchema, getAsyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@liberiaemr/esm-liberia-audit-log-app';

const options = { featureName: 'liberia-audit-log', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const root = getAsyncLifecycle(() => import('./audit-log/audit-log.component'), options);

export const auditLogAppMenuItem = getAsyncLifecycle(
  () => import('./audit-log/audit-log-app-menu-item.component'),
  options,
);
