import { describe, expect, it } from 'vitest';
import {
  HUMAN_ACTIVITY_STORAGE_KEY,
  clearHumanActivity,
  readHumanActivity,
  recordHumanActivity,
  resolveIdleTimeoutMinutes,
} from './idle-timeout';

describe('resolveIdleTimeoutMinutes', () => {
  it('defaults a missing value to 10 minutes', () => {
    expect(resolveIdleTimeoutMinutes(undefined)).toBe(10);
    expect(resolveIdleTimeoutMinutes(null)).toBe(10);
    expect(resolveIdleTimeoutMinutes('')).toBe(10);
  });

  it('parses the Maven-filtered JSON string "10"', () => {
    expect(resolveIdleTimeoutMinutes('10')).toBe(10);
    expect(resolveIdleTimeoutMinutes(' 10 ')).toBe(10);
    expect(resolveIdleTimeoutMinutes(10)).toBe(10);
  });

  it('clamps a value above 10 minutes to 10', () => {
    expect(resolveIdleTimeoutMinutes('30')).toBe(10);
    expect(resolveIdleTimeoutMinutes(15)).toBe(10);
    expect(resolveIdleTimeoutMinutes('10.1')).toBe(10);
  });

  it('does not read a millisecond figure as minutes', () => {
    expect(resolveIdleTimeoutMinutes('600000')).toBe(10);
    expect(resolveIdleTimeoutMinutes(600000)).toBe(10);
  });

  it('falls back to 10 when the value is malformed', () => {
    expect(resolveIdleTimeoutMinutes('nope')).toBe(10);
    expect(resolveIdleTimeoutMinutes('10min')).toBe(10);
    expect(resolveIdleTimeoutMinutes('1e1')).toBe(10);
    expect(resolveIdleTimeoutMinutes(0)).toBe(10);
    expect(resolveIdleTimeoutMinutes(-5)).toBe(10);
    expect(resolveIdleTimeoutMinutes(Number.NaN)).toBe(10);
    expect(resolveIdleTimeoutMinutes(true)).toBe(10);
  });

  it('honors a shorter positive value', () => {
    expect(resolveIdleTimeoutMinutes('5')).toBe(5);
    expect(resolveIdleTimeoutMinutes(1)).toBe(1);
    expect(resolveIdleTimeoutMinutes('0.5')).toBe(0.5);
  });
});

describe('human activity timestamp', () => {
  it('stores only the timestamp', () => {
    recordHumanActivity(1_700_000_000_000);
    expect(localStorage.getItem(HUMAN_ACTIVITY_STORAGE_KEY)).toBe('1700000000000');
    expect(readHumanActivity(1_700_000_000_000)).toEqual({ status: 'ok', at: 1_700_000_000_000 });
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe(HUMAN_ACTIVITY_STORAGE_KEY);
  });

  it('treats a missing value as missing and a future or garbage value as invalid', () => {
    localStorage.removeItem(HUMAN_ACTIVITY_STORAGE_KEY);
    expect(readHumanActivity()).toEqual({ status: 'missing' });

    localStorage.setItem(HUMAN_ACTIVITY_STORAGE_KEY, 'not-a-time');
    expect(readHumanActivity(1_000)).toEqual({ status: 'invalid' });

    localStorage.setItem(HUMAN_ACTIVITY_STORAGE_KEY, String(1_000_000));
    expect(readHumanActivity(1_000)).toEqual({ status: 'invalid' });
  });

  it('clears the timestamp without writing anything else', () => {
    recordHumanActivity(50);
    clearHumanActivity();
    expect(localStorage.getItem(HUMAN_ACTIVITY_STORAGE_KEY)).toBeNull();
  });
});
