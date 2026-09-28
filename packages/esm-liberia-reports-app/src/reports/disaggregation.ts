/** The part of react-i18next's t this file uses. */
type TFunction = (key: string, fallback: string, options?: Record<string, unknown>) => string;

/** A column of an evaluated data set, as reportingrest's DataSetMetaDataConverter writes it. */
export interface DataSetColumn {
  name: string;
  label?: string | null;
  display?: string | null;
  datatype?: string | null;
}

export interface IndicatorCell {
  column: string;
  /** The column's suffix after the indicator code, e.g. `NUM_F`; empty for the headline value. */
  part: string;
  /** The column label: the DHIS2 short name where one exists (docs/reporting/README.md section 3.3). */
  label: string;
  value: unknown;
}

export interface IndicatorGroup {
  /** The workbook code, e.g. `MAL-004`; empty for columns that follow no code. */
  code: string;
  cells: Array<IndicatorCell>;
}

// <CODE>_<part>: the workbook code upper-cased with '-' replaced by '_', e.g. MAL_004_NUM or
// EMR_OPS_001_F. The code ends at its three-digit number.
const COLUMN = /^([A-Z]+(?:_[A-Z]+)*)_(\d{3})(?:_(.+))?$/;

export function parseColumnName(name: string): { code: string; part: string } | null {
  const match = COLUMN.exec(name);
  if (!match) {
    return null;
  }
  return { code: `${match[1].replace(/_/g, '-')}-${match[2]}`, part: match[3] ?? '' };
}

/**
 * Groups one data set row's values by indicator, keeping the data set's column order. Columns
 * that follow no `<CODE>_<part>` name are kept, in one group with an empty code, so nothing the
 * backend sends is hidden.
 */
export function groupByIndicator(columns: Array<DataSetColumn>, row: Record<string, unknown>): Array<IndicatorGroup> {
  const groups = new Map<string, IndicatorGroup>();
  for (const column of columns) {
    const parsed = parseColumnName(column.name);
    const code = parsed?.code ?? '';
    if (!groups.has(code)) {
      groups.set(code, { code, cells: [] });
    }
    groups.get(code).cells.push({
      column: column.name,
      part: parsed?.part ?? column.name,
      label: column.label || column.display || column.name,
      value: row?.[column.name],
    });
  }
  const ordered = [...groups.values()];
  // Unnamed columns last.
  return [...ordered.filter((g) => g.code), ...ordered.filter((g) => !g.code)];
}

/** Describes a column suffix in words: `NUM_F` is "Numerator, female"; `1_4` is "1–4 years". */
export function describePart(part: string, t: TFunction): string {
  if (!part) {
    return t('total', 'Total');
  }
  const words: Array<string> = [];
  // Age bands carry an underscore of their own (1_4, 15_49), so take them out first.
  const rest = part.replace(/(^|_)(\d+)_(\d+)(?=_|$)/g, (_m, lead, from, to) => `${lead}AGE:${from}–${to}`);
  for (const token of rest.split('_')) {
    if (token.startsWith('AGE:')) {
      words.push(t('ageBand', '{{band}} years', { band: token.slice(4) }));
    } else if (/^LT\d+$/.test(token)) {
      words.push(t('ageUnder', 'Under {{age}}', { age: token.slice(2) }));
    } else if (/^\d+PLUS$/.test(token)) {
      words.push(t('agePlus', '{{age}}+ years', { age: token.slice(0, -4) }));
    } else {
      words.push(knownToken(token, t) ?? token);
    }
  }
  const sentence = words.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function knownToken(token: string, t: TFunction): string | undefined {
  switch (token) {
    case 'NUM':
      return t('numerator', 'numerator');
    case 'DEN':
      return t('denominator', 'denominator');
    case 'PCT':
      return t('percent', 'percent');
    case 'F':
      return t('female', 'female');
    case 'M':
      return t('male', 'male');
    case 'TOTAL':
      return t('total', 'Total');
    default:
      return undefined;
  }
}

/** A data set cell as text. reportingrest sends indicator results as numbers and cohorts as {size}. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'object' && 'size' in (value as object)) {
    return String((value as { size: unknown }).size);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}
