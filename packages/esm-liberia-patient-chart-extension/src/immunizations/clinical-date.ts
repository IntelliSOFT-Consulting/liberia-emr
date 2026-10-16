import { addDateOffset } from './eligibility.ts';

/** Date-only values stay date-only. Timestamps are instants in Africa/Monrovia. */
export function clinicalDate(value: string): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing clinical date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return addDateOffset(value, { value: 0, unit: 'days' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new Error('A complete date or timestamp with timezone is required');
  }
  const instant = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid timestamp');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Monrovia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Invalid timestamp');
  return addDateOffset(`${year}-${month}-${day}`, { value: 0, unit: 'days' });
}
