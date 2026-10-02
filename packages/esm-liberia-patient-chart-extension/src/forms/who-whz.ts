/**
 * WHO Child Growth Standards (2006) weight-for-length/height Z-score.
 *
 * Direct port of the reporting calculation in
 * sp_mamba_fact_nutrition_anthropometry.sql. The stock form-engine
 * calcWeightForHeightZscore helper is not equivalent: it returns the sentinel
 * '-4' and only covers length 45–110 cm.
 *
 * Length (L, 45–110 cm) is used when age is under 731 days, otherwise standing
 * height (H, 65–120 cm). The form does not record whether the child lay or
 * stood, so there is no 0.7 cm adjustment. Out of range returns null.
 */
import table from './who-wflh-lms.json' with { type: 'json' };

type WhoLmsRow = [string, string, number, number, number, number];

const MAX_AGE_DAYS = 1856;
const LENGTH_CUTOFF_DAYS = 731;

const lms = new Map<string, [number, number, number]>();
for (const [measure, sex, cm, l, m, s] of table as WhoLmsRow[]) {
  lms.set(`${measure}|${sex}|${Number(cm).toFixed(1)}`, [l, m, s]);
}

/** MariaDB ROUND(x, places): half away from zero. */
function roundHalfAwayFromZero(value: number, places: number): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(scaled))) / factor;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function calendarDate(value: unknown): CalendarDate | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) {
      return null;
    }
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  return null;
}

function utcDayNumber(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function ageInDays(birthDate: unknown, encounterDate: unknown): number | null {
  const birth = calendarDate(birthDate);
  const encounter = calendarDate(encounterDate);
  if (!birth || !encounter) {
    return null;
  }
  return utcDayNumber(encounter) - utcDayNumber(birth);
}

/**
 * Completed calendar months, matching TIMESTAMPDIFF(MONTH, birth, encounter)
 * for date-valued inputs. 31 January to 28 February is 0 completed months.
 */
function completedAgeInMonths(birthDate: unknown, encounterDate: unknown): number | null {
  const birth = calendarDate(birthDate);
  const encounter = calendarDate(encounterDate);
  if (!birth || !encounter) {
    return null;
  }
  let months = (encounter.year - birth.year) * 12 + (encounter.month - birth.month);
  if (encounter.day < birth.day) {
    months -= 1;
  }
  return months;
}

export function isMuacRequired(birthDate: unknown, encounterDate: unknown): boolean {
  const months = completedAgeInMonths(birthDate, encounterDate);
  if (months == null) {
    return false;
  }
  return months >= 6 && months <= 59;
}

function asPositiveNumber(raw: unknown): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function lookup(measure: string, sex: string, cm: number): [number, number, number] | undefined {
  return lms.get(`${measure}|${sex}|${cm.toFixed(1)}`);
}

/** Form-engine helper for the transient Triage W/Z display. */
export function calcLiberiaWhz(
  weightInput: unknown,
  heightInput: unknown,
  encounterDate: unknown,
  birthDate: unknown,
  sexInput: unknown,
): number | null {
  const sex = typeof sexInput === 'string' ? sexInput.toUpperCase() : '';
  const ageDays = ageInDays(birthDate, encounterDate);
  const ageMonths = completedAgeInMonths(birthDate, encounterDate);
  const weightRaw = asPositiveNumber(weightInput);
  const heightRaw = asPositiveNumber(heightInput);
  if (
    (sex !== 'M' && sex !== 'F') ||
    weightRaw == null ||
    heightRaw == null ||
    ageDays == null ||
    ageMonths == null ||
    ageDays < 0 ||
    ageDays > MAX_AGE_DAYS ||
    ageMonths >= 60
  ) {
    return null;
  }

  const weight = roundHalfAwayFromZero(weightRaw, 2);
  const height = roundHalfAwayFromZero(heightRaw, 1);
  if (weight <= 0) {
    return null;
  }

  let measure: 'L' | 'H' | null = null;
  if (ageDays < LENGTH_CUTOFF_DAYS && height >= 45 && height <= 110) {
    measure = 'L';
  } else if (ageDays >= LENGTH_CUTOFF_DAYS && height >= 65 && height <= 120) {
    measure = 'H';
  }
  if (!measure) {
    return null;
  }

  const lenheiLow = Math.floor(roundHalfAwayFromZero(height * 10, 6)) / 10;
  const lenheiDiff = (height - lenheiLow) / 0.1;
  const low = lookup(measure, sex, lenheiLow);
  if (!low) {
    return null;
  }
  const high = lookup(measure, sex, lenheiLow + 0.1) ?? low;
  const l = low[0] + lenheiDiff * (high[0] - low[0]);
  const m = low[1] + lenheiDiff * (high[1] - low[1]);
  const s = low[2] + lenheiDiff * (high[2] - low[2]);
  if (l === 0 || s === 0 || m === 0) {
    return null;
  }

  let z = (Math.pow(weight / m, l) - 1) / (s * l);
  if (z > 3) {
    const sd3 = m * Math.pow(1 + l * s * 3, 1 / l);
    const sd2 = m * Math.pow(1 + l * s * 2, 1 / l);
    z = 3 + (weight - sd3) / (sd3 - sd2);
  } else if (z < -3) {
    const sd3 = m * Math.pow(1 + l * s * -3, 1 / l);
    const sd2 = m * Math.pow(1 + l * s * -2, 1 / l);
    z = -3 + (weight - sd3) / (sd2 - sd3);
  }
  if (!Number.isFinite(z)) {
    return null;
  }
  return roundHalfAwayFromZero(z, 2);
}
