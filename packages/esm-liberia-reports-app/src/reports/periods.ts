import dayjs, { type Dayjs } from 'dayjs';

export type PeriodType = 'month' | 'quarter';

export interface ReportPeriod {
  /** Stable key, e.g. 2026-07 or 2026-Q3. */
  id: string;
  type: PeriodType;
  label: string;
  /** ISO dates, both inclusive (docs/reporting/README.md section 3.2). */
  startDate: string;
  endDate: string;
  /** The period has not ended yet, so its figures are still growing. */
  inProgress: boolean;
}

const iso = (date: Dayjs) => date.format('YYYY-MM-DD');

/** The current month and the ones before it, newest first. */
export function monthlyPeriods(now: Date, count: number): Array<ReportPeriod> {
  const current = dayjs(now).startOf('month');
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const start = current.subtract(i, 'month');
    const end = start.endOf('month');
    return {
      id: start.format('YYYY-MM'),
      type: 'month',
      label: start.format('MMMM YYYY'),
      startDate: iso(start),
      endDate: iso(end),
      inProgress: i === 0,
    };
  });
}

/** The current calendar quarter and the ones before it, newest first. */
export function quarterlyPeriods(now: Date, count: number): Array<ReportPeriod> {
  const today = dayjs(now);
  const currentStart = today.startOf('month').month(Math.floor(today.month() / 3) * 3);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const start = currentStart.subtract(i * 3, 'month');
    const end = start.add(2, 'month').endOf('month');
    const quarter = Math.floor(start.month() / 3) + 1;
    return {
      id: `${start.year()}-Q${quarter}`,
      type: 'quarter',
      label: `Q${quarter} ${start.year()} (${start.format('MMM')}–${end.format('MMM')})`,
      startDate: iso(start),
      endDate: iso(end),
      inProgress: i === 0,
    };
  });
}
