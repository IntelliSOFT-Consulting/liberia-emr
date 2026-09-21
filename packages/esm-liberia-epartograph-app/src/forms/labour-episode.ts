/**
 * Pregnancy / labour episode boundary used by the e-partograph.
 * A Delivery / Stage 3 encounter ends the previous pregnancy; later
 * partograph encounters belong to the current episode.
 *
 * Keep this matching the generic delivery identity used by L&D form prefills.
 * Do not invent a calendar window here.
 */

export interface EpisodeEncounter {
  uuid?: string;
  encounterDatetime: string;
  encounterType?: { uuid?: string; display?: string };
  form?: { uuid?: string; name?: string; display?: string };
}

export interface LabourEpisodeConfig {
  deliveryEncounterTypeUuid?: string;
  thirdStageFormUuid?: string;
}

/** Stage 3 / Delivery identity from the e-partograph episode resolver. */
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
