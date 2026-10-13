import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAge, formatAsOf, type DateHelpers } from './format-as-of.ts';

const t = (_key: string, fallback: string) => fallback;

// Stand-ins for the framework's helpers: a fixed date string and a duration in the unit given.
const helpers = (duration: Record<string, number> | null, locale = 'en-GB'): DateHelpers => ({
  formatDatetime: () => '02-Oct-2026, 08:14',
  duration: () => duration,
  locale,
});

const when = new Date('2026-10-02T08:14:00Z');
const now = new Date('2026-10-04T09:30:00Z');

describe('formatAsOf', () => {
  it('puts the framework date and the relative age together', () => {
    assert.equal(formatAsOf(when, now, helpers({ days: 2 }), t), '02-Oct-2026, 08:14 (2 days ago)');
  });

  it('accepts the ISO string the server sends', () => {
    assert.equal(formatAsOf(when.toISOString(), now, helpers({ hours: 3 }), t), '02-Oct-2026, 08:14 (3 hours ago)');
  });
});

describe('formatAge', () => {
  const cases: Array<[Record<string, number> | null, string]> = [
    [{ seconds: 20 }, 'just now'],
    [{ minutes: 0 }, 'just now'],
    [{ minutes: -5 }, 'just now'], // clock skew
    [null, 'just now'],
    [{ minutes: 1 }, '1 minute ago'],
    [{ hours: 3 }, '3 hours ago'],
    [{ days: 1 }, 'yesterday'],
    [{ days: 2 }, '2 days ago'],
    [{ months: 6 }, '6 months ago'],
    [{ years: 2 }, '2 years ago'],
  ];
  for (const [duration, expected] of cases) {
    it(`${JSON.stringify(duration)} → ${expected}`, () =>
      assert.equal(formatAge(when, now, helpers(duration), t), expected));
  }

  it('follows the user’s locale', () => {
    assert.equal(formatAge(when, now, helpers({ days: 2 }, 'fr'), t), 'avant-hier');
    assert.equal(formatAge(when, now, helpers({ hours: 3 }, 'fr'), t), 'il y a 3 heures');
  });

  it('translates "just now", the one phrase not from Intl', () => {
    assert.equal(
      formatAge(when, now, helpers({ seconds: 5 }), (key) => key),
      'ageJustNow',
    );
  });
});
