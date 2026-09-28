/**
 * A fake reportingrest and reports-module backend for the tests, until the reports module
 * (docs/reporting/README.md section 3) exists. Responses follow the shapes read from the
 * reportingrest-omod 2.0.0 sources: ReportRequestResource, ReportDesignResource,
 * EvaluatedDataSetResource with DataSetMetaDataConverter, and ReportFile. All data is synthetic.
 *
 * Wire it with `mockOpenmrsFetch.mockImplementation(backend.fetch)`.
 */
import type { ReportingContextResponse } from '../context/reporting-context.resource';

export const RMNCAH = 'report-rmncah';
export const MALARIA = 'report-malaria';
export const UNLISTED = 'report-not-moh';
export const CSV_DESIGN = 'design-malaria-csv';
export const XLSX_DESIGN = 'design-malaria-xlsx';

export interface Call {
  url: string;
  method: string;
  body?: any;
}

export interface MockBackendOptions {
  context?: ReportingContextResponse | 'missing';
  /** How many polls a request reports PROCESSING before it finishes. */
  pollsBeforeDone?: number;
  finalStatus?: 'COMPLETED' | 'FAILED';
  /** How downloadReport encodes fileContent. */
  fileEncoding?: 'base64' | 'bytes';
  /** Which designs every report has. Default: CSV and Excel. */
  designs?: 'csv-and-excel' | 'excel-only' | 'none';
  /** Hold every reportRequest POST until `releasePosts()` is called. */
  holdPosts?: boolean;
  /** Request UUIDs whose status reads fail with a server error. */
  failPolls?: Array<string>;
}

export const csvBody = 'Indicator,Value\nMAL_004_NUM,12\n';

export function createMockBackend(initialOptions: MockBackendOptions = {}) {
  const options = { ...initialOptions };
  const calls: Array<Call> = [];
  const polls = new Map<string, number>();
  const designs = new Map<string, string>();
  const heldPosts: Array<() => void> = [];
  let nextRequest = 1;
  /** What reportDataSet counts. Change it to stand in for an ETL refresh between runs. */
  const figures = { MAL_004_NUM: 12, MAL_004_F: 7, MAL_004_LT1: 2, MAL_004_15_49: 5, NCD_007_PCT: 33.333 };

  const reply = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
  const fail = (status: number, message: string) =>
    Promise.reject(Object.assign(new Error(message), { response: { status }, responseBody: { error: { message } } }));

  const fetch = (url: string, init: { method?: string; body?: any } = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body });
    const path = url.replace(/^\/ws\/rest\/v1\//, '');

    if (path === 'liberiaemrreports/context') {
      if (!options.context || options.context === 'missing') {
        return fail(404, 'Not found');
      }
      return reply(options.context);
    }

    if (path === 'reportingrest/reportDefinition?v=full') {
      return reply({
        results: [
          { uuid: UNLISTED, name: 'Some other report', parameters: [] },
          {
            uuid: MALARIA,
            name: 'MOH Malaria Indicators',
            display: 'MOH Malaria Indicators',
            description: 'Not captured: suspected cases (MAL-015) and LLINs outside ANC (MAL-011).',
            parameters: [
              { name: 'startDate', type: 'java.util.Date' },
              { name: 'endDate', type: 'java.util.Date' },
              { name: 'location', type: 'org.openmrs.Location' },
            ],
          },
          { uuid: RMNCAH, name: 'MOH RMNCAH Indicators', display: 'MOH RMNCAH Indicators', parameters: [] },
        ],
      });
    }

    if (path.startsWith('reportingrest/reportDesign?reportDefinitionUuid=')) {
      const excel = {
        uuid: XLSX_DESIGN,
        name: 'MOH Malaria Indicators (Excel)',
        rendererType: 'org.openmrs.module.reporting.report.renderer.ExcelTemplateRenderer',
      };
      const csv = {
        uuid: CSV_DESIGN,
        name: 'MOH Malaria Indicators (CSV)',
        rendererType: 'org.openmrs.module.reporting.report.renderer.CsvReportRenderer',
      };
      const designsSetUp = options.designs ?? 'csv-and-excel';
      return reply({
        results: designsSetUp === 'none' ? [] : designsSetUp === 'excel-only' ? [excel] : [excel, csv],
      });
    }

    if (path === 'reportingrest/reportRequest' && method === 'POST') {
      const uuid = `request-${nextRequest++}`;
      polls.set(uuid, 0);
      designs.set(uuid, init.body?.renderingMode?.argument);
      if (options.holdPosts) {
        return new Promise((resolve) => heldPosts.push(() => resolve(reply({ uuid, status: 'REQUESTED' }))));
      }
      return reply({ uuid, status: 'REQUESTED' });
    }

    const request = /^reportingrest\/reportRequest\/([^?]+)$/.exec(path);
    if (request && method === 'DELETE') {
      polls.delete(request[1]);
      return Promise.resolve({ ok: true, status: 204, data: undefined });
    }
    if (request && options.failPolls?.includes(request[1])) {
      return fail(500, 'Status unavailable');
    }
    if (request) {
      const seen = polls.get(request[1]) ?? 0;
      polls.set(request[1], seen + 1);
      const done = seen >= (options.pollsBeforeDone ?? 1);
      return reply({ uuid: request[1], status: done ? options.finalStatus ?? 'COMPLETED' : 'PROCESSING' });
    }

    if (path.startsWith('reportingrest/reportDataSet/')) {
      return reply({
        metadata: {
          columns: [
            { name: 'MAL_004_NUM', label: 'Malaria confirmed cases', datatype: 'java.lang.Integer' },
            { name: 'MAL_004_F', label: 'Malaria confirmed cases, female', datatype: 'java.lang.Integer' },
            { name: 'MAL_004_LT1', label: 'Malaria confirmed cases, under 1', datatype: 'java.lang.Integer' },
            { name: 'MAL_004_15_49', label: 'Malaria confirmed cases, 15-49', datatype: 'java.lang.Integer' },
            { name: 'NCD_007_PCT', label: 'Raised blood pressure', datatype: 'java.lang.Double' },
          ],
        },
        rows: [{ ...figures }],
      });
    }

    if (path.startsWith('reportingrest/downloadReport?reportRequestUuid=')) {
      const uuid = decodeURIComponent(path.split('=')[1]);
      const isExcel = designs.get(uuid) === XLSX_DESIGN;
      const bytes = Array.from(new TextEncoder().encode(csvBody));
      return reply({
        filename: isExcel ? 'MOH_Malaria_Indicators.xlsx' : 'MOH_Malaria_Indicators.csv',
        contentType: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
        fileContent: options.fileEncoding === 'bytes' ? bytes : btoa(csvBody),
      });
    }

    if (path.startsWith('location?')) {
      const county = { uuid: 'county-bong', display: 'Bong' };
      const otherCounty = { uuid: 'county-montserrado', display: 'Montserrado' };
      const district = { uuid: 'district-jorquelleh', display: 'Jorquelleh', parentLocation: county };
      const otherDistrict = { uuid: 'district-careysburg', display: 'Careysburg', parentLocation: otherCounty };
      return reply({
        totalCount: 2,
        results: [
          { uuid: 'facility-phebe', display: 'Phebe Hospital', parentLocation: district, attributes: [] },
          { uuid: 'facility-careysburg', display: 'Careysburg Health Center', parentLocation: otherDistrict, attributes: [] },
        ],
      });
    }

    return fail(404, `No mock for ${method} ${url}`);
  };

  const releasePosts = () => heldPosts.splice(0).forEach((release) => release());
  /** What the context endpoint answers from now on, e.g. after an outage ends. */
  const setContext = (context: MockBackendOptions['context']) => {
    options.context = context;
  };

  return { fetch, calls, releasePosts, setContext, figures };
}
