import { addDateOffset } from './eligibility.ts';

/** Preserve date-only values; timestamps are instants in Liberia, never browser-local days. */
export function clinicalDate(value: string): string {
  if (typeof value !== 'string') throw new Error('Missing clinical date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return addDateOffset(value, { value: 0, unit: 'days' });
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new Error('A complete date or timestamp with timezone is required');
  }
  addDateOffset(value.slice(0, 10), { value: 0, unit: 'days' });
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid timestamp');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Monrovia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return addDateOffset(`${part('year')}-${part('month')}-${part('day')}`, { value: 0, unit: 'days' });
}
