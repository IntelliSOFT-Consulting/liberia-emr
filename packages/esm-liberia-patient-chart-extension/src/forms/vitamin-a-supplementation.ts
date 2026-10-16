/**
 * Child Vitamin A supplementation (observation, not a vaccine).
 *
 * Age bands and the requirement to block a dose that does not match the child's
 * age come from the Immunization data dictionary (EMR.IMMZ.DE51). Strengths are
 * Blue 100,000 IU and Red 200,000 IU. The dictionary descriptions that say
 * 10,000 IU and 20,000 IU are wrong and are not used.
 *
 * Schedule details the dictionary does not state — once-only Blue, six-calendar-month
 * Red, current-age catch-up, and the provisional 30-day minimum — are applied as
 * documented in docs/architecture/vitamin-a-supplementation.md.
 */

export const VITAMIN_A_BLUE_START_MONTHS = 6;
export const VITAMIN_A_RED_START_MONTHS = 12;
/** Exclusive upper bound: the 5th birthday. */
export const VITAMIN_A_RED_END_MONTHS = 60;
export const VITAMIN_A_RED_ROUTINE_MONTHS = 6;

/**
 * Minimum calendar days between Vitamin A administrations.
 *
 * Provenance: Mercy Kamau product clarification, provisional until the national
 * guideline or the Data Dictionary confirms it. The Data Dictionary does not
 * state this interval. It is a safety floor, not the routine Red return interval.
 */
export const VITAMIN_A_MINIMUM_INTERVAL_DAYS = 30;

/**
 * Whether a repeat Red dose may be saved after the provisional 30-day gap and
 * before the six-calendar-month routine date.
 *
 * Not settled. The data dictionary says administer Red every six months. The
 * product clarification says the routine schedule remains six-monthly and also
 * asks for a 30-day minimum, pending the national guideline. This build allows
 * the save and marks it not routinely due. Set this to false to hard-block
 * that window once the rule is confirmed. Do not describe 30 days as a
 * dictionary rule.
 */
export const VITAMIN_A_RED_REPEAT_ALLOWED_BEFORE_ROUTINE = true;

export type VitaminAStrength = 'blue' | 'red';

export type VitaminABlock =
  | ''
  | 'age'
  | 'date'
  | 'strength'
  | 'blue-repeat'
  | 'minimum-interval'
  | 'history'
  | 'red-before-routine';

export interface VitaminAAdministration {
  id: string;
  strength: VitaminAStrength;
  /** Calendar date the dose was given. Date received when recorded, otherwise the encounter date. */
  administeredDate: string;
  dateSource: 'date-received' | 'encounter-datetime';
  encounterUuid: string;
  /** Calendar date of the encounter that recorded the dose. */
  encounterDate: string;
}

export interface VitaminAHistoryRead {
  complete: boolean;
  administrations: VitaminAAdministration[];
}

export interface VitaminAConcepts {
  blue: string;
  red: string;
  dateReceived: string;
}

export interface VitaminADoseDecision {
  block: VitaminABlock;
  canAdminister: boolean;
  /** True when this date is the routine time for the dose, which for Red is six calendar months after the previous administration. */
  routinelyDue: boolean;
  /** True when every other dose is at least the provisional minimum interval away. Distinct from routinelyDue. */
  minimumIntervalSatisfied: boolean;
  currentStrength: VitaminAStrength | null;
  /** Next return date from this administration, or null when none should be generated. */
  returnDate: string | null;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function isRealCalendarDate(date: CalendarDate): boolean {
  if (date.year < 1 || date.year > 9999) {
    return false;
  }
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return (
    utc.getUTCFullYear() === date.year &&
    utc.getUTCMonth() === date.month - 1 &&
    utc.getUTCDate() === date.day
  );
}

function toIso(date: CalendarDate): string {
  const year = String(date.year).padStart(4, '0');
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Date-only strings stay calendar dates. Instants use the local calendar date. */
export function calendarDate(value: unknown): CalendarDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
    return isRealCalendarDate(date) ? date : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const date = { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
    return isRealCalendarDate(date) ? date : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    const date = { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
    return isRealCalendarDate(date) ? date : null;
  }
  return null;
}

export function calendarIso(value: unknown): string | null {
  const date = calendarDate(value);
  return date ? toIso(date) : null;
}

/** Months clamp to the last day of the target month. Not a fixed day count. */
export function addCalendarMonths(value: unknown, months: number): string | null {
  const date = calendarDate(value);
  if (!date || !Number.isInteger(months)) {
    return null;
  }
  const monthIndex = date.month - 1 + months;
  const year = date.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = { year, month: month + 1, day: Math.min(date.day, lastDay) };
  return isRealCalendarDate(result) ? toIso(result) : null;
}

export function addCalendarDays(value: unknown, days: number): string | null {
  const date = calendarDate(value);
  if (!date || !Number.isInteger(days)) {
    return null;
  }
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const result = { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
  return isRealCalendarDate(result) ? toIso(result) : null;
}

/** Later minus earlier, in calendar days. Negative when later is before earlier. */
export function calendarDaysBetween(earlier: unknown, later: unknown): number | null {
  const start = calendarDate(earlier);
  const end = calendarDate(later);
  if (!start || !end) {
    return null;
  }
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

export function vitaminAStrengthForAge(birthDate: unknown, onDate: unknown): VitaminAStrength | null {
  const birth = calendarIso(birthDate);
  const on = calendarIso(onDate);
  if (!birth || !on || on < birth) {
    return null;
  }
  const blueStart = addCalendarMonths(birth, VITAMIN_A_BLUE_START_MONTHS);
  const redStart = addCalendarMonths(birth, VITAMIN_A_RED_START_MONTHS);
  const fifthBirthday = addCalendarMonths(birth, VITAMIN_A_RED_END_MONTHS);
  if (!blueStart || !redStart || !fifthBirthday) {
    return null;
  }
  if (on < blueStart) {
    return null;
  }
  if (on < redStart) {
    return 'blue';
  }
  if (on < fifthBirthday) {
    return 'red';
  }
  return null;
}

function strengthFromUuid(value: unknown, concepts: VitaminAConcepts): VitaminAStrength | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  if (value === concepts.blue) {
    return 'blue';
  }
  if (value === concepts.red) {
    return 'red';
  }
  return null;
}

function conceptUuid(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (value && typeof value === 'object' && 'uuid' in value) {
    const uuid = (value as { uuid?: unknown }).uuid;
    if (typeof uuid === 'string' && uuid.trim()) {
      return uuid;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Reads child Vitamin A administrations from Supplementary immunization activities
 * observations. A medication order is not an administration and is ignored.
 * A dose with no Date received uses the encounter date. A dose with neither date
 * makes the read incomplete so the caller does not treat history as empty.
 */
export function vitaminAAdministrationsFromObs(
  entries: readonly unknown[],
  concepts: VitaminAConcepts,
): VitaminAHistoryRead {
  const administrations: VitaminAAdministration[] = [];
  const seen = new Set<string>();
  let complete = true;

  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record || record.resourceType === 'MedicationRequest' || record.voided === true) {
      continue;
    }
    const strength = strengthFromUuid(conceptUuid(record.value), concepts);
    if (!strength) {
      continue;
    }
    const id = typeof record.uuid === 'string' ? record.uuid : '';
    if (!id || seen.has(id)) {
      complete = false;
      continue;
    }
    seen.add(id);

    const encounter = asRecord(record.encounter);
    const encounterUuid = encounter && typeof encounter.uuid === 'string' ? encounter.uuid : '';
    const encounterDate = calendarIso(encounter?.encounterDatetime);
    const siblings = Array.isArray(encounter?.obs) ? encounter.obs : [];
    let dateReceived: string | null = null;
    for (const sibling of siblings) {
      const obs = asRecord(sibling);
      if (!obs || obs.voided === true) {
        continue;
      }
      if (conceptUuid(obs.concept) !== concepts.dateReceived) {
        continue;
      }
      dateReceived = calendarIso(obs.value);
      if (dateReceived) {
        break;
      }
    }

    const administeredDate = dateReceived ?? encounterDate;
    if (!administeredDate || !encounterDate || !encounterUuid) {
      complete = false;
      continue;
    }
    administrations.push({
      id,
      strength,
      administeredDate,
      dateSource: dateReceived ? 'date-received' : 'encounter-datetime',
      encounterUuid,
      encounterDate,
    });
  }

  administrations.sort((left, right) =>
    left.administeredDate === right.administeredDate
      ? left.id.localeCompare(right.id)
      : left.administeredDate < right.administeredDate
        ? -1
        : 1,
  );
  return { complete, administrations };
}

function parseHistory(history: unknown, concepts: VitaminAConcepts): VitaminAHistoryRead | null {
  if (typeof history === 'string') {
    const text = history.trim();
    if (!text || text === 'error') {
      return null;
    }
    try {
      return parseHistory(JSON.parse(text) as unknown, concepts);
    } catch {
      return null;
    }
  }
  if (Array.isArray(history)) {
    const administrations: VitaminAAdministration[] = [];
    for (const entry of history) {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const strength = record.strength === 'blue' || record.strength === 'red' ? record.strength : null;
      const administeredDate = calendarIso(record.administeredDate);
      const encounterDate = calendarIso(record.encounterDate);
      const id = typeof record.id === 'string' ? record.id : '';
      const encounterUuid = typeof record.encounterUuid === 'string' ? record.encounterUuid : '';
      const dateSource = record.dateSource === 'date-received' || record.dateSource === 'encounter-datetime'
        ? record.dateSource
        : null;
      if (!strength || !administeredDate || !encounterDate || !id || !encounterUuid || !dateSource) {
        return null;
      }
      administrations.push({ id, strength, administeredDate, dateSource, encounterUuid, encounterDate });
    }
    return { complete: true, administrations };
  }
  return null;
}

function isBlank(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }
  return false;
}

/**
 * Drops only the encounter being edited. A different encounter on the same
 * calendar day stays in history. Without an encounter UUID, nothing is dropped:
 * date equality would hide that other encounter.
 */
function historyForDecision(
  history: VitaminAHistoryRead,
  mode: unknown,
  currentEncounterUuid: unknown,
): VitaminAAdministration[] {
  if (mode !== 'edit') {
    return history.administrations;
  }
  const current = typeof currentEncounterUuid === 'string' ? currentEncounterUuid.trim() : '';
  if (!current) {
    return history.administrations;
  }
  return history.administrations.filter((dose) => dose.encounterUuid !== current);
}

function latestOnOrBefore(history: readonly VitaminAAdministration[], dateGiven: string): string | null {
  let latest: string | null = null;
  for (const dose of history) {
    if (dose.administeredDate <= dateGiven && (latest === null || dose.administeredDate > latest)) {
      latest = dose.administeredDate;
    }
  }
  return latest;
}

function withinMinimumInterval(history: readonly VitaminAAdministration[], dateGiven: string): boolean {
  return history.some((dose) => {
    const days = calendarDaysBetween(dose.administeredDate, dateGiven);
    return days !== null && Math.abs(days) < VITAMIN_A_MINIMUM_INTERVAL_DAYS;
  });
}

export function vitaminAReturnDate(
  birthDate: unknown,
  dateGiven: unknown,
  strength: VitaminAStrength,
  today: unknown,
): string | null {
  const birth = calendarIso(birthDate);
  const given = calendarIso(dateGiven);
  const todayIso = calendarIso(today);
  if (!birth || !given || !todayIso || vitaminAStrengthForAge(birth, given) !== strength) {
    return null;
  }
  const fifthBirthday = addCalendarMonths(birth, VITAMIN_A_RED_END_MONTHS);
  if (!fifthBirthday) {
    return null;
  }
  let next: string | null;
  if (strength === 'blue') {
    const redStart = addCalendarMonths(birth, VITAMIN_A_RED_START_MONTHS);
    const afterGap = addCalendarDays(given, VITAMIN_A_MINIMUM_INTERVAL_DAYS);
    if (!redStart || !afterGap) {
      return null;
    }
    next = redStart > afterGap ? redStart : afterGap;
  } else {
    next = addCalendarMonths(given, VITAMIN_A_RED_ROUTINE_MONTHS);
  }
  if (!next || next >= fifthBirthday || next <= todayIso) {
    return null;
  }
  return next;
}

export function evaluateVitaminADose(input: {
  birthDate: unknown;
  asOf: unknown;
  dateGiven: unknown;
  strengthUuid: unknown;
  history: unknown;
  concepts: VitaminAConcepts;
  mode?: unknown;
  /** Encounter being edited. Ignored unless mode is edit. */
  currentEncounterUuid?: unknown;
}): VitaminADoseDecision {
  const currentStrength = vitaminAStrengthForAge(input.birthDate, input.asOf);
  const selected = strengthFromUuid(input.strengthUuid, input.concepts);
  const dateGiven = calendarIso(input.dateGiven);
  const asOf = calendarIso(input.asOf);
  const birth = calendarIso(input.birthDate);
  const empty: VitaminADoseDecision = {
    block: '',
    canAdminister: false,
    routinelyDue: false,
    minimumIntervalSatisfied: false,
    currentStrength,
    returnDate: null,
  };

  if (!selected && !dateGiven) {
    return { ...empty, canAdminister: false, minimumIntervalSatisfied: true };
  }
  if (!selected) {
    return { ...empty, block: 'strength' };
  }
  if (!birth || !asOf || selected !== currentStrength) {
    return { ...empty, block: 'age' };
  }
  if (!dateGiven) {
    return { ...empty, block: 'date' };
  }
  if (dateGiven < birth || dateGiven > asOf) {
    return { ...empty, block: 'date' };
  }
  if (vitaminAStrengthForAge(birth, dateGiven) !== selected) {
    return { ...empty, block: 'age' };
  }

  const parsed = parseHistory(input.history, input.concepts);
  if (!parsed?.complete) {
    return { ...empty, block: 'history' };
  }
  const history = historyForDecision(parsed, input.mode, input.currentEncounterUuid);
  const minimumIntervalSatisfied = !withinMinimumInterval(history, dateGiven);
  if (selected === 'blue' && history.some((dose) => dose.strength === 'blue')) {
    return { ...empty, block: 'blue-repeat', minimumIntervalSatisfied };
  }
  if (!minimumIntervalSatisfied) {
    return { ...empty, block: 'minimum-interval', minimumIntervalSatisfied: false };
  }

  const previous = latestOnOrBefore(history, dateGiven);
  const routineAnchor = previous ? addCalendarMonths(previous, VITAMIN_A_RED_ROUTINE_MONTHS) : null;
  const routinelyDue = selected === 'blue' || routineAnchor === null || dateGiven >= routineAnchor;
  if (selected === 'red' && !routinelyDue && !VITAMIN_A_RED_REPEAT_ALLOWED_BEFORE_ROUTINE) {
    return {
      block: 'red-before-routine',
      canAdminister: false,
      routinelyDue: false,
      minimumIntervalSatisfied: true,
      currentStrength,
      returnDate: null,
    };
  }
  return {
    block: '',
    canAdminister: true,
    routinelyDue,
    minimumIntervalSatisfied: true,
    currentStrength,
    returnDate: vitaminAReturnDate(birth, dateGiven, selected, input.asOf),
  };
}

/** Form-engine helper. '' when the child is outside both Vitamin A age bands. */
export function vitaminACurrentStrength(birthDate: unknown, asOf: unknown): VitaminAStrength | '' {
  return vitaminAStrengthForAge(birthDate, asOf) ?? '';
}

/** Form-engine helper. Returns a block code, or '' when the value may be saved. */
export function vitaminABlock(
  birthDate: unknown,
  asOf: unknown,
  dateGiven: unknown,
  strengthUuid: unknown,
  history: unknown,
  blueUuid: unknown,
  redUuid: unknown,
  mode: unknown,
  currentEncounterUuid?: unknown,
): VitaminABlock {
  return evaluateVitaminADose({
    birthDate,
    asOf,
    dateGiven,
    strengthUuid,
    history,
    mode,
    currentEncounterUuid,
    concepts: { blue: String(blueUuid ?? ''), red: String(redUuid ?? ''), dateReceived: '' },
  }).block;
}

/**
 * Form-engine helper. A Date at local noon, or null when no Vitamin A return date
 * should be written. A null result is what the form uses to clear a stale
 * Vitamin A return date on recalculation.
 */
export function vitaminAReturnDateValue(
  birthDate: unknown,
  dateGiven: unknown,
  strengthUuid: unknown,
  blueUuid: unknown,
  redUuid: unknown,
  today: unknown,
): Date | null {
  const strength = strengthFromUuid(strengthUuid, {
    blue: String(blueUuid ?? ''),
    red: String(redUuid ?? ''),
    dateReceived: '',
  });
  if (!strength) {
    return null;
  }
  const iso = vitaminAReturnDate(birthDate, dateGiven, strength, today);
  if (!iso) {
    return null;
  }
  const date = calendarDate(iso);
  if (!date) {
    return null;
  }
  return new Date(date.year, date.month - 1, date.day, 12, 0, 0, 0);
}

/**
 * Return date for the shared DE49 field.
 *
 * A selected vaccine keeps the current value. The shared field cannot hold a
 * vaccine return date and a Vitamin A return date at once.
 * When Vitamin A is selected and Date received is set, the result is the
 * calculated date, or null when that date is no longer valid. Null is the
 * clear signal for a stale Vitamin A value. Otherwise the current value stays.
 */
export function vitaminASharedReturnValue(
  vaccineName: unknown,
  birthDate: unknown,
  dateGiven: unknown,
  strengthUuid: unknown,
  blueUuid: unknown,
  redUuid: unknown,
  today: unknown,
  currentReturn: unknown,
): unknown {
  if (!isBlank(vaccineName)) {
    return currentReturn;
  }
  if (isBlank(strengthUuid) || isBlank(dateGiven)) {
    return currentReturn;
  }
  return vitaminAReturnDateValue(birthDate, dateGiven, strengthUuid, blueUuid, redUuid, today);
}

/**
 * Oral default for a Vitamin A-only administration. A selected vaccine keeps
 * the current route, including an empty one. One Route field cannot record
 * Vitamin A's route separately from the vaccine route.
 */
export function vitaminARouteValue(
  vaccineName: unknown,
  vitaminAStrength: unknown,
  currentRoute: unknown,
  oralUuid: unknown,
): unknown {
  if (isBlank(vaccineName) && !isBlank(vitaminAStrength) && isBlank(currentRoute) && !isBlank(oralUuid)) {
    return oralUuid;
  }
  return currentRoute;
}

/** True only for a Vitamin A-only administration whose route is not Oral. */
export function vitaminARouteRejected(
  vaccineName: unknown,
  vitaminAStrength: unknown,
  route: unknown,
  oralUuid: unknown,
): boolean {
  if (!isBlank(vaccineName) || isBlank(vitaminAStrength)) {
    return false;
  }
  return !isBlank(route) && route !== oralUuid;
}

/**
 * Encounter UUID of the Immunization form open in the patient form workspace.
 * The form-engine expression context does not include the encounter UUID.
 * The workspace props do, when the form was opened for edit.
 */
export function vitaminAEncounterUuidFromWorkspace(state: unknown): string {
  const windows = asRecord(state)?.openedWindows;
  if (!Array.isArray(windows)) {
    return '';
  }
  for (let windowIndex = windows.length - 1; windowIndex >= 0; windowIndex -= 1) {
    const opened = asRecord(windows[windowIndex])?.openedWorkspaces;
    if (!Array.isArray(opened)) {
      continue;
    }
    for (let workspaceIndex = opened.length - 1; workspaceIndex >= 0; workspaceIndex -= 1) {
      const workspace = asRecord(opened[workspaceIndex]);
      if (!workspace || workspace.workspaceName !== 'patient-form-entry-workspace') {
        continue;
      }
      const props = asRecord(workspace.props);
      const uuid = props && typeof props.encounterUuid === 'string' ? props.encounterUuid.trim() : '';
      if (uuid) {
        return uuid;
      }
    }
  }
  return '';
}
