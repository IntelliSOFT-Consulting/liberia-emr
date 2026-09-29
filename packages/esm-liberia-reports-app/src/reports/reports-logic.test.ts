import { monthlyPeriods, quarterlyPeriods } from './periods';
import { describePart, formatValue, groupByIndicator, parseColumnName } from './disaggregation';
import { toReportBlob } from './report-file';
import { buildReportRequest, findDesign, isFinished, previewUrl } from './reports.resource';
import { isLocationKnown, toReportingContext } from '../context/reporting-context.resource';

const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name]));

describe('periods', () => {
  const now = new Date(2026, 8, 27); // 27 September 2026

  it('offers whole months, newest first, with inclusive ISO bounds', () => {
    const months = monthlyPeriods(now, 3);
    expect(months.map((m) => [m.id, m.startDate, m.endDate, m.inProgress])).toEqual([
      ['2026-09', '2026-09-01', '2026-09-30', true],
      ['2026-08', '2026-08-01', '2026-08-31', false],
      ['2026-07', '2026-07-01', '2026-07-31', false],
    ]);
  });

  it('offers calendar quarters across a year boundary', () => {
    const quarters = quarterlyPeriods(now, 4);
    expect(quarters.map((q) => [q.id, q.startDate, q.endDate])).toEqual([
      ['2026-Q3', '2026-07-01', '2026-09-30'],
      ['2026-Q2', '2026-04-01', '2026-06-30'],
      ['2026-Q1', '2026-01-01', '2026-03-31'],
      ['2025-Q4', '2025-10-01', '2025-12-31'],
    ]);
  });
});

describe('disaggregation', () => {
  it('splits a column name into the workbook code and its disaggregation', () => {
    expect(parseColumnName('MAL_004_NUM')).toEqual({ code: 'MAL-004', part: 'NUM' });
    expect(parseColumnName('EMR_OPS_001_F')).toEqual({ code: 'EMR-OPS-001', part: 'F' });
    expect(parseColumnName('RMNCAH_016')).toEqual({ code: 'RMNCAH-016', part: '' });
    expect(parseColumnName('facility_name')).toBeNull();
  });

  it('describes disaggregations in words, age bands included', () => {
    expect(describePart('NUM_F', t)).toBe('Numerator, female');
    expect(describePart('15_49', t)).toBe('15–49 years');
    expect(describePart('DEN_1_4_M', t)).toBe('Denominator, 1–4 years, male');
    expect(describePart('LT1', t)).toBe('Under 1');
    expect(describePart('50PLUS', t)).toBe('50+ years');
    expect(describePart('', t)).toBe('Total');
  });

  it('groups columns by indicator in data set order and keeps unnamed columns last', () => {
    const groups = groupByIndicator(
      [
        { name: 'extra' },
        { name: 'MAL_004_NUM', label: 'Confirmed' },
        { name: 'NCD_007_PCT' },
        { name: 'MAL_004_F' },
      ],
      { MAL_004_NUM: 3, MAL_004_F: 1, NCD_007_PCT: 50, extra: 'x' },
    );
    expect(groups.map((g) => [g.code, g.cells.map((c) => c.column)])).toEqual([
      ['MAL-004', ['MAL_004_NUM', 'MAL_004_F']],
      ['NCD-007', ['NCD_007_PCT']],
      ['', ['extra']],
    ]);
    expect(groups[0].cells[0].label).toBe('Confirmed');
  });

  it('formats cohort sizes, decimals and blanks', () => {
    expect(formatValue({ size: 4, memberIds: [1] })).toBe('4');
    expect(formatValue(33.333)).toBe('33.3');
    expect(formatValue(null)).toBe('—');
  });
});

describe('downloadReport fileContent', () => {
  const read = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });

  it('decodes base64 in JSON, which is how Jackson writes byte[]', async () => {
    const blob = toReportBlob({ filename: 'a.csv', contentType: 'text/csv', fileContent: btoa('a,b\n1,2\n') });
    expect(await read(blob)).toBe('a,b\n1,2\n');
    expect(blob.type).toBe('text/csv');
  });

  it('accepts a JSON array of bytes', async () => {
    const bytes = Array.from(new TextEncoder().encode('a,b\n'));
    expect(await read(toReportBlob({ filename: 'a.csv', contentType: 'text/csv', fileContent: bytes }))).toBe('a,b\n');
  });

  it('passes unencoded text through', async () => {
    expect(await read(toReportBlob({ filename: 'a.csv', contentType: 'text/csv', fileContent: 'a,b\n1,2' }))).toBe(
      'a,b\n1,2',
    );
  });

  it('refuses a file with no content', () => {
    expect(() => toReportBlob({ filename: 'a.csv', contentType: 'text/csv', fileContent: null })).toThrow();
  });
});

describe('reportingrest requests', () => {
  it('builds the section 4.1 body, leaving location out for national', () => {
    expect(buildReportRequest('r', 'd', { startDate: '2026-07-01', endDate: '2026-09-30' })).toEqual({
      status: 'REQUESTED',
      priority: 'NORMAL',
      reportDefinition: {
        parameterizable: { uuid: 'r' },
        parameterMappings: { startDate: '2026-07-01', endDate: '2026-09-30' },
      },
      renderingMode: { argument: 'd' },
    });
    expect(
      buildReportRequest('r', 'd', { startDate: 'a', endDate: 'b', locationUuid: 'loc' }).reportDefinition
        .parameterMappings,
    ).toEqual({ startDate: 'a', endDate: 'b', location: 'loc' });
  });

  it('previews the same parameters through reportDataSet', () => {
    expect(previewUrl('r', 'indicators', { startDate: 'a', endDate: 'b', locationUuid: 'loc' })).toBe(
      '/ws/rest/v1/reportingrest/reportDataSet/r/indicators?startDate=a&endDate=b&location=loc',
    );
  });

  it('tells the CSV and Excel designs apart by renderer, then by name', () => {
    const designs = [
      { uuid: 'x', name: 'Excel', rendererType: 'org.openmrs.module.reporting.report.renderer.ExcelTemplateRenderer' },
      { uuid: 'c', name: 'Anything', rendererType: 'org.openmrs.module.reporting.report.renderer.CsvReportRenderer' },
    ];
    expect(findDesign(designs, 'csv')?.uuid).toBe('c');
    expect(findDesign(designs, 'xlsx')?.uuid).toBe('x');
    expect(findDesign([{ uuid: 'n', name: 'Malaria (CSV)' }], 'csv')?.uuid).toBe('n');
  });

  it('stops polling on COMPLETED, FAILED and SAVED only', () => {
    expect(['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'SAVED'].map((s) => isFinished(s as any))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('instance role', () => {
  it('fails closed to facility when the role is missing or unknown', () => {
    expect(toReportingContext(undefined)).toMatchObject({ role: 'facility', roleUnknown: true });
    expect(toReportingContext({ instanceRole: 'regional' })).toMatchObject({ role: 'facility', roleUnknown: true });
  });

  it('is central only when the backend says so, and then has no fixed facility', () => {
    expect(
      toReportingContext({ instanceRole: 'CENTRAL', facilityLocation: { uuid: 'f' } }),
    ).toMatchObject({ role: 'central', roleUnknown: false, facilityLocation: undefined });
  });

  it('knows the location only from an answered context: central, or a facility with its UUID', () => {
    expect(isLocationKnown(toReportingContext(undefined))).toBe(false);
    expect(isLocationKnown(toReportingContext({}))).toBe(false);
    expect(isLocationKnown(toReportingContext({ instanceRole: 'facility', facilityLocation: null }))).toBe(false);
    expect(isLocationKnown(toReportingContext({ instanceRole: 'facility', facilityLocation: { uuid: 'f' } }))).toBe(true);
    // Role missing: a facility, which the backend clamps to; its own UUID is still sent.
    expect(isLocationKnown(toReportingContext({ facilityLocation: { uuid: 'f' } }))).toBe(true);
    expect(isLocationKnown(toReportingContext({ instanceRole: 'central', facilityLocation: null }))).toBe(true);
  });

  it('carries the facility location and the last ETL run at a facility', () => {
    expect(
      toReportingContext({
        instanceRole: 'facility',
        facilityLocation: { uuid: 'f', display: 'Careysburg' },
        etlLastRun: { completedAt: '2026-09-27T10:00:00.000+0000', status: 'SUCCESS' },
      }),
    ).toMatchObject({
      role: 'facility',
      facilityLocation: { uuid: 'f', display: 'Careysburg' },
      etlCompletedAt: '2026-09-27T10:00:00.000+0000',
    });
  });
});
