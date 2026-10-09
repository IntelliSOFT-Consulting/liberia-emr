/** `t` from react-i18next, or a stand-in in tests. */
export type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

type Unit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

/** The framework's date helpers, passed in so this stays testable without the app shell. */
export interface DateHelpers {
  /** `formatDatetime` from `@openmrs/esm-framework`, e.g. "02-Oct-2026, 08:14". */
  formatDatetime: (date: Date) => string;
  /** `duration` from `@openmrs/esm-framework`: picks the unit, e.g. `{ days: 2 }`. */
  duration: (from: Date, to: Date) => Partial<Record<Unit, number>> | null;
  /** `getLocale()` from `@openmrs/esm-framework`. */
  locale: string;
}

const intlUnits: Record<Unit, Intl.RelativeTimeFormatUnit> = {
  seconds: 'second',
  minutes: 'minute',
  hours: 'hour',
  days: 'day',
  weeks: 'week',
  months: 'month',
  years: 'year',
};

/** "just now", "3 hours ago", "yesterday"… in the user's locale. Future times (clock skew) are just now. */
export function formatAge(date: Date, now: Date, helpers: DateHelpers, t: Translate): string {
  const [unit, value] = (Object.entries(helpers.duration(date, now) ?? {})[0] ?? []) as [Unit?, number?];
  if (!unit || unit === 'seconds' || !value || value <= 0) {
    return t('ageJustNow', 'just now');
  }
  return new Intl.RelativeTimeFormat(helpers.locale, { numeric: 'auto' }).format(-value, intlUnits[unit]);
}

/** "02-Oct-2026, 08:14 (2 days ago)": how the age of the cached copy is shown everywhere. */
export function formatAsOf(when: string | Date, now: Date, helpers: DateHelpers, t: Translate): string {
  const date = typeof when === 'string' ? new Date(when) : when;
  return `${helpers.formatDatetime(date)} (${formatAge(date, now, helpers, t)})`;
}
