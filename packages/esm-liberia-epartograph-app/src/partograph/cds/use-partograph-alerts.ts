import { useMemo } from 'react';
import type { EPartographConfig } from '../../config-schema';
import { findObs, getNumericObsValue, type PartographEncounter } from '../use-partograph-encounters';

/**
 * The four CDS states that the WHO partograph defines.
 * These map directly to the toast variants shown in the designs.
 *
 *  - normal:   Labour is progressing as expected (≤ Alert Line). → Green toast.
 *  - alert:    Labour has crossed the Alert Line but not yet the Action Line. → Yellow toast.
 *  - action:   Labour has crossed the Action Line. Immediate clinical decision required. → Red toast.
 *  - due:      The next partograph assessment is overdue. → Blue/info toast.
 *  - none:     No data yet — no toast.
 */
export type PartographAlertStatus = 'normal' | 'alert' | 'action' | 'due' | 'none';

export interface PartographAlertResult {
  status: PartographAlertStatus;
  /** ISO timestamp of T₀ (when dilation first reached alertLine.startDilationCm). */
  t0?: Date;
  /** Current cervical dilation value (cm) from the latest encounter. */
  currentDilationCm?: number;
  /** Dilation on the Alert Line at the current time (cm). */
  alertLineDilationAtNow?: number;
  /** Whether the next assessment interval (30 min) is overdue. */
  isAssessmentDue: boolean;
  /** Minutes since the last encounter. */
  minutesSinceLastEntry?: number;
}

/** Assessment interval: 30 minutes during active labour (WHO standard). */
const ASSESSMENT_INTERVAL_MIN = 30;

/**
 * Computes the expected dilation on the WHO Alert Line at a given elapsed time.
 *
 * Formula:
 *   dilationAtT = startDilationCm + (elapsedHours × cmPerHour)
 *   Capped at 10 cm.
 */
function alertLineDilation(elapsedMs: number, startDilationCm: number, cmPerHour: number): number {
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  return Math.min(10, startDilationCm + elapsedHours * cmPerHour);
}

/**
 * Computes the expected dilation on the WHO Action Line.
 * The Action Line is identical in slope to the Alert Line but shifted
 * `actionLineOffsetHours` to the right.
 *
 *   actionLineDilation(t) = alertLineDilation(t - offset)
 *   i.e. alertLine starts offsetHours later than the Alert Line.
 */
function actionLineDilation(elapsedMs: number, startDilationCm: number, cmPerHour: number, actionLineOffsetHours: number): number {
  const offsetMs = actionLineOffsetHours * 60 * 60 * 1000;
  const adjustedElapsedMs = elapsedMs - offsetMs;
  if (adjustedElapsedMs < 0) return 0; // action line hasn't started yet
  return alertLineDilation(adjustedElapsedMs, startDilationCm, cmPerHour);
}

/**
 * Core Clinical Decision Support hook for the WHO Electronic Partograph.
 *
 * Given the list of partograph encounters (oldest-first) and the alert/action line
 * config, it computes the current CDS status by:
 *
 *  1. Finding T₀: the time of the FIRST encounter where dilation ≥ startDilationCm.
 *  2. Reading the LATEST dilation value.
 *  3. Computing where the Alert and Action lines are at the current real-world time.
 *  4. Comparing current dilation against those reference lines.
 *  5. Checking whether the last entry is >30 minutes ago.
 */
export function usePartographAlerts(
  encounters: PartographEncounter[],
  config: EPartographConfig,
): PartographAlertResult {
  return useMemo(() => {
    const noData: PartographAlertResult = { status: 'none', isAssessmentDue: false };

    if (!encounters.length) return noData;

    const { startDilationCm, cmPerHour, actionLineOffsetHours } = config.alertLine;
    const cervicalDilationUuid = config.concepts.cervicalDilationUuid;

    if (!cervicalDilationUuid) return noData;

    // --- 1. Find T₀: first encounter where dilation ≥ startDilationCm ---
    let t0: Date | undefined;
    for (const enc of encounters) {
      const obs = findObs(enc, cervicalDilationUuid);
      const dilation = getNumericObsValue(obs);
      if (dilation !== null && dilation >= startDilationCm) {
        t0 = new Date(enc.encounterDatetime);
        break;
      }
    }

    // No T₀ yet — labour hasn't entered active phase.
    if (!t0) return noData;

    // --- 2. Get the latest encounter and its dilation value ---
    const lastEncounter = encounters[encounters.length - 1];
    const lastObs = findObs(lastEncounter, cervicalDilationUuid);
    const currentDilationCm = getNumericObsValue(lastObs);

    // --- 3. Determine assessment overdue status ---
    const now = new Date();
    const lastEntryTime = new Date(lastEncounter.encounterDatetime);
    const minutesSinceLastEntry = (now.getTime() - lastEntryTime.getTime()) / (1000 * 60);
    const isAssessmentDue = minutesSinceLastEntry > ASSESSMENT_INTERVAL_MIN;

    // If we have no dilation reading on the last encounter, default to 'due' if overdue.
    if (currentDilationCm === null) {
      return {
        status: isAssessmentDue ? 'due' : 'normal',
        t0,
        isAssessmentDue,
        minutesSinceLastEntry,
      };
    }

    // --- 4. Compute Alert/Action line values at the current real-world time ---
    const elapsedSinceT0Ms = now.getTime() - t0.getTime();
    const alertAtNow = alertLineDilation(elapsedSinceT0Ms, startDilationCm, cmPerHour);
    const actionAtNow = actionLineDilation(elapsedSinceT0Ms, startDilationCm, cmPerHour, actionLineOffsetHours);

    // --- 5. Compare current dilation against the reference lines ---
    let status: PartographAlertStatus;
    if (currentDilationCm >= actionAtNow && actionAtNow > 0) {
      status = 'action'; // Action Line Reached — immediate clinical intervention
    } else if (currentDilationCm >= alertAtNow) {
      status = 'alert'; // Alert Line crossed — labour requires review
    } else if (isAssessmentDue) {
      status = 'due'; // Labour is within lines but an entry is overdue
    } else {
      status = 'normal'; // Labour progressing normally
    }

    return {
      status,
      t0,
      currentDilationCm,
      alertLineDilationAtNow: alertAtNow,
      isAssessmentDue,
      minutesSinceLastEntry,
    };
  }, [encounters, config]);
}

/**
 * Generates chart-ready points for the WHO Alert Line.
 *
 * Returns an array of { x: Date, y: number } spanning from T₀ to
 * when the alert line reaches 10 cm, at 30-minute intervals.
 */
export function generateAlertLinePoints(
  t0: Date,
  startDilationCm: number,
  cmPerHour: number,
): Array<{ x: Date; y: number }> {
  const points: Array<{ x: Date; y: number }> = [];
  const hoursToComplete = (10 - startDilationCm) / cmPerHour;
  const intervalMs = 30 * 60 * 1000; // 30-minute steps
  const totalMs = hoursToComplete * 60 * 60 * 1000;

  for (let ms = 0; ms <= totalMs; ms += intervalMs) {
    const x = new Date(t0.getTime() + ms);
    const y = alertLineDilation(ms, startDilationCm, cmPerHour);
    points.push({ x, y });
  }
  return points;
}

/**
 * Generates chart-ready points for the WHO Action Line.
 * Same slope as Alert Line, shifted `actionLineOffsetHours` to the right.
 */
export function generateActionLinePoints(
  t0: Date,
  startDilationCm: number,
  cmPerHour: number,
  actionLineOffsetHours: number,
): Array<{ x: Date; y: number }> {
  const offsetMs = actionLineOffsetHours * 60 * 60 * 1000;
  const actionT0 = new Date(t0.getTime() + offsetMs);
  return generateAlertLinePoints(actionT0, startDilationCm, cmPerHour);
}
