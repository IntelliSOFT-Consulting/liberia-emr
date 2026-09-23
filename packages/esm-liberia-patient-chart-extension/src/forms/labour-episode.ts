/**
 * Pregnancy / labour episode boundary used by form-engine helpers.
 * A Delivery / Stage 3 encounter ends the previous pregnancy; later ANC or
 * labour encounters belong to the current episode.
 *
 * Delivery identity is an independently built copy of the same clinical
 * episode boundary used by the e-partograph delivery filter. Neither copy is
 * a code-level source of truth for the other. Do not invent a calendar window
 * here.
 */

export interface EpisodeObs {
  uuid?: string;
  concept?: { uuid?: string; display?: string };
  value?: string | number | { uuid?: string; display?: string };
}

export interface EpisodeEncounter {
  uuid?: string;
  encounterDatetime: string;
  encounterType?: { uuid?: string; display?: string };
  form?: { uuid?: string; name?: string; display?: string };
  obs?: EpisodeObs[];
}

export interface LabourEpisodeConfig {
  deliveryEncounterTypeUuid?: string;
  thirdStageFormUuid?: string;
  ancInitialEncounterTypeUuid?: string;
  ancInitialFormUuid?: string;
  ancNationalFormName?: string;
}

export const ANC_INITIAL_FORM_NAME = 'ANC Initial Visit';
export const DEFAULT_ANC_NATIONAL_FORM_NAME = '1. ANC Form';

/**
 * IMPORTANT: Keep this delivery-episode identity semantically identical to the
 * delivery filter in
 * packages/esm-liberia-epartograph-app/src/partograph/use-partograph-encounters.ts.
 *
 * These are independently built copies in separately bundled ESMs. Neither
 * file is a code-level source of truth for the other. Both predicates
 * intentionally define the same pregnancy/labour episode boundary and must
 * change together. Any change to encounter-type matching, Third Stage form
 * matching, or fallback form-name matching must update both locations in the
 * same PR.
 *
 * TODO: extract this into a shared frontend library when the repository has a
 * supported JS workspace/shared-package structure.
 */
export function isDeliveryEncounter(enc: EpisodeEncounter, config: LabourEpisodeConfig): boolean {
  if (config.deliveryEncounterTypeUuid && enc.encounterType?.uuid === config.deliveryEncounterTypeUuid) {
    return true;
  }
  if (config.thirdStageFormUuid && enc.form?.uuid === config.thirdStageFormUuid) {
    return true;
  }
  const formName = enc.form?.name || enc.form?.display || '';
  // Anchored to avoid matching Stage 1 / Stage 2.
  return /^3\.|third stage|delivery summary/i.test(formName);
}

/**
 * Exclusive lower bound for the current pregnancy: datetime of the latest
 * delivery strictly before `beforeTime`. `0` means no prior delivery in-record.
 */
export function previousDeliveryTimeBefore(
  encounters: EpisodeEncounter[],
  config: LabourEpisodeConfig,
  beforeTime: number,
): number {
  const priorDeliveries = encounters
    .filter((enc) => isDeliveryEncounter(enc, config))
    .map((enc) => new Date(enc.encounterDatetime).getTime())
    .filter((time) => Number.isFinite(time) && time < beforeTime)
    .sort((a, b) => a - b);

  return priorDeliveries.length ? priorDeliveries[priorDeliveries.length - 1] : 0;
}

export function isAncInitialEncounter(enc: EpisodeEncounter, config: LabourEpisodeConfig): boolean {
  if (config.ancInitialEncounterTypeUuid && enc.encounterType?.uuid === config.ancInitialEncounterTypeUuid) {
    return true;
  }
  if (config.ancInitialFormUuid && enc.form?.uuid === config.ancInitialFormUuid) {
    return true;
  }
  const formName = enc.form?.name || enc.form?.display || '';
  return formName === ANC_INITIAL_FORM_NAME;
}

/**
 * Legacy national ANC sheet. Identified by its form name, never by the generic
 * Consultation encounter type that the form happens to use.
 */
export function isNationalAncFormEncounter(enc: EpisodeEncounter, config: LabourEpisodeConfig): boolean {
  const formName = enc.form?.name || enc.form?.display || '';
  const expected = config.ancNationalFormName || DEFAULT_ANC_NATIONAL_FORM_NAME;
  return formName === expected;
}

export function isAncSourceEncounter(enc: EpisodeEncounter, config: LabourEpisodeConfig): boolean {
  return isAncInitialEncounter(enc, config) || isNationalAncFormEncounter(enc, config);
}

export function parseNumericObsValue(obs: EpisodeObs | undefined): number | null {
  if (!obs) {
    return null;
  }
  if (typeof obs.value === 'number' && Number.isFinite(obs.value)) {
    return obs.value;
  }
  const raw =
    typeof obs.value === 'object' && obs.value !== null
      ? (obs.value as { display?: string }).display
      : obs.value;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const num = parseFloat(String(raw));
  return Number.isFinite(num) ? num : null;
}

function obsForConcept(enc: EpisodeEncounter, conceptUuid: string): EpisodeObs | undefined {
  return enc.obs?.find((o) => o.concept?.uuid === conceptUuid);
}

function encounterTime(enc: EpisodeEncounter): number {
  return new Date(enc.encounterDatetime).getTime();
}

function newestFirstPreferringInitial(config: LabourEpisodeConfig) {
  return (a: EpisodeEncounter, b: EpisodeEncounter) => {
    const timeDiff = encounterTime(b) - encounterTime(a);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return Number(isAncInitialEncounter(b, config)) - Number(isAncInitialEncounter(a, config));
  };
}

/**
 * Latest applicable ANC numeric obs for `conceptUuid` in the current pregnancy.
 *
 * Source order: ANC Initial Visit first (records Gravida and Parity), then
 * legacy `1. ANC Form` for existing patient data. Values from L&D, PNC, FP or
 * generic Consultation encounters are ignored. Observations at or after
 * `asOf` or at or before the previous delivery are ignored.
 */
export function selectLatestAncNumeric(
  encounters: EpisodeEncounter[],
  conceptUuid: string,
  config: LabourEpisodeConfig,
  asOf: Date,
): number | null {
  if (!conceptUuid) {
    return null;
  }

  const asOfTime = asOf.getTime();
  if (!Number.isFinite(asOfTime)) {
    return null;
  }

  const episodeStart = previousDeliveryTimeBefore(encounters, config, asOfTime);
  const initials: EpisodeEncounter[] = [];
  const national: EpisodeEncounter[] = [];

  for (const enc of encounters) {
    const time = encounterTime(enc);
    if (!Number.isFinite(time) || time <= episodeStart || time >= asOfTime) {
      continue;
    }
    if (isAncInitialEncounter(enc, config)) {
      initials.push(enc);
    } else if (isNationalAncFormEncounter(enc, config)) {
      national.push(enc);
    }
  }

  const preferred = [
    ...initials.sort(newestFirstPreferringInitial(config)),
    ...national.sort(newestFirstPreferringInitial(config)),
  ];

  for (const enc of preferred) {
    const value = parseNumericObsValue(obsForConcept(enc, conceptUuid));
    if (value !== null) {
      return value;
    }
  }

  return null;
}
