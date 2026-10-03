/**
 * @liberiaemr/esm-liberia-reports-app
 *
 * CUSTOM BUILD (IMPLEMENTATION.md section 3). Runs the MOH indicator reports (LE-335): choose a
 * report, a month or quarter and a location; run it; follow its status; read the figures by
 * disaggregation; export CSV or Excel. The same bundle serves a facility, which reports on
 * itself, and central, which reports on any county, district or facility, or the nation.
 *
 * Why not @openmrs/esm-reports-app: docs/adr/0010-indicator-reporting-mamba-etl.md, decision 8.
 */
import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { createHomeDashboardLink } from './home-dashboard/home-dashboard-link.component';
import { EXPORT_PRIVILEGE, REPORTS_DASHBOARD } from './privileges';

const moduleName = '@liberiaemr/esm-liberia-reports-app';

const options = { featureName: 'liberia-indicator-reports', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const root = getAsyncLifecycle(() => import('./reports/report-runner.component'), options);

export const reportsAppMenuItem = getAsyncLifecycle(
  () => import('./reports/reports-app-menu-item.component'),
  options,
);

// The National Reporting Officer's home page (/home/indicator-reports), the same page as
// /indicator-reports; config-national.json names it in esm-home-app's defaultDashboardPerRole.
export const reportsDashboardLink = getSyncLifecycle(
  // t('indicatorReports', 'Indicator reports')
  createHomeDashboardLink({
    name: REPORTS_DASHBOARD,
    titleKey: 'indicatorReports',
    title: 'Indicator reports',
    privilege: EXPORT_PRIVILEGE,
  }),
  options,
);
