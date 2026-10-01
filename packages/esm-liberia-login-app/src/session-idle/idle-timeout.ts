/**
 * Human-inactivity timeout for the MOH ICT SOP (10 minutes).
 *
 * The unit is minutes of human activity, not milliseconds and not HTTP traffic.
 * A site may configure a shorter positive value. Nothing above 10 minutes is honored.
 */

/** Contractual maximum. Also the fallback when configuration is missing or invalid. */
export const MOH_MAX_IDLE_MINUTES = 10;

/**
 * Shared across tabs of this origin. A millisecond timestamp only — never a
 * session id, cookie, or credential.
 */
export const HUMAN_ACTIVITY_STORAGE_KEY = 'liberiaemr.lastHumanActivityAt';

/** How far in the future a stored timestamp may be before it is treated as unusable. */
const CLOCK_SKEW_MS = 5000;

export type HumanActivityRead = { status: 'missing' } | { status: 'invalid' } | { status: 'ok'; at: number };

/**
 * Resolve the idle period in minutes.
 *
 * Maven resource filtering substitutes `${var.security.session.timeout-minutes}`
 * inside JSON quotes, so the built value is a string such as `"10"`. A JSON
 * number is accepted as well. Values are minutes: `600000` is not read as
 * milliseconds, it is above the maximum and clamps to 10.
 */
export function resolveIdleTimeoutMinutes(value: unknown): number {
  const parsed = parseMinutes(value);
  if (parsed == null || parsed > MOH_MAX_IDLE_MINUTES) {
    return MOH_MAX_IDLE_MINUTES;
  }
  return parsed;
}

export function readHumanActivity(now = Date.now()): HumanActivityRead {
  let raw: string | null;
  try {
    raw = localStorage.getItem(HUMAN_ACTIVITY_STORAGE_KEY);
  } catch {
    return { status: 'invalid' };
  }
  if (raw == null) {
    return { status: 'missing' };
  }
  if (!/^\d+$/.test(raw)) {
    return { status: 'invalid' };
  }
  const at = Number(raw);
  if (!Number.isFinite(at) || at > now + CLOCK_SKEW_MS) {
    return { status: 'invalid' };
  }
  return { status: 'ok', at };
}

export function recordHumanActivity(at: number): void {
  try {
    localStorage.setItem(HUMAN_ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    // Leave the timestamp unset. The next read is missing or invalid, and the watcher fails closed.
  }
}

export function clearHumanActivity(): void {
  try {
    localStorage.removeItem(HUMAN_ACTIVITY_STORAGE_KEY);
  } catch {
    // Cleanup must not interrupt logout when storage is unavailable.
  }
}

function parseMinutes(value: unknown): number | null {
  if (typeof value === 'number') {
    return positiveFinite(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  return positiveFinite(Number(trimmed));
}

function positiveFinite(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}
