/** Observation fields the history cell reads. Matches the encounter REST custom representation. */
export interface HistoryObs {
  concept?: { uuid?: string; display?: string };
  value?: string | number | { uuid?: string; display?: string };
  display?: string;
}

/** One concept that may fill a history column, with the unit the clinician selected. */
export interface HistoryConceptRef {
  concept: string;
  unit?: string;
}

/** A history column. `concepts` lets one column show a unit-specific pair without a second cell. */
export interface HistoryColumn {
  concept: string;
  label?: string;
  concepts?: HistoryConceptRef[];
}

/**
 * Concepts that count for this column. A unit pair (for example mg/dL and mmol/L
 * serum glucose) is one measurement: the column lists both, and a saved row has one of them.
 */
export function columnConceptUuids(column: HistoryColumn): string[] {
  const listed = (column.concepts ?? []).map((item) => item.concept).filter(Boolean);
  if (listed.length) {
    return listed;
  }
  return column.concept ? [column.concept] : [];
}

/**
 * Cell text for one encounter. The unit comes from the concept that was saved,
 * never from the size of the number. A column with no unit map keeps the previous display.
 */
export function formatHistoryCell(observations: HistoryObs[] | undefined, column: HistoryColumn): string {
  const specs = column.concepts?.length ? column.concepts : [{ concept: column.concept, unit: '' }];
  const parts: string[] = [];
  for (const spec of specs) {
    const match = observations?.find((item) => item.concept?.uuid === spec.concept);
    if (!match) {
      continue;
    }
    parts.push(formatObsWithUnit(match, spec.unit ?? ''));
  }
  return parts.length ? parts.join('; ') : '--';
}

export function formatObsWithUnit(obs: HistoryObs | undefined, unit: string): string {
  if (!obs) {
    return '--';
  }
  if (!unit) {
    return displayValue(obs);
  }
  const quantity = quantityText(obs.value);
  if (quantity === null) {
    return displayValue(obs);
  }
  return `${quantity} ${unit}`;
}

function displayValue(obs: HistoryObs | undefined): string {
  if (!obs) {
    return '--';
  }
  if (typeof obs.value === 'object' && obs.value !== null) {
    return obs.value.display ?? '--';
  }
  if (obs.value === undefined || obs.value === null || obs.value === '') {
    return '--';
  }
  return String(obs.value);
}

/** Whole numbers stay whole. Other values keep the digits JavaScript already has; nothing is rounded. */
function quantityText(value: HistoryObs['value']): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Number.isInteger(numeric) ? String(numeric) : String(numeric);
    }
  }
  return null;
}
