import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { selectLatestAncNumeric, type EpisodeEncounter, type LabourEpisodeConfig } from './labour-episode';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

const ENCOUNTER_REP =
  'custom:(uuid,encounterDatetime,encounterType:(uuid,display),form:(uuid,name,display),obs:(uuid,concept:(uuid,display),value))';

async function fetchPatientEncounters(patientUuid: string): Promise<EpisodeEncounter[]> {
  const url = `${restBaseUrl}/encounter?patient=${encodeURIComponent(patientUuid)}&v=${ENCOUNTER_REP}&limit=100`;
  const response = await openmrsFetch<{ results?: EpisodeEncounter[] }>(url);
  return response?.data?.results ?? [];
}

/**
 * Form-engine expression helper. Returns a Promise so schemas can use
 * `.then(v => v)` inside calculateExpression.
 */
export async function getCurrentPregnancyAncNumeric(
  patientUuid: string,
  conceptUuid: string,
): Promise<number | null> {
  if (!patientUuid || !conceptUuid) {
    return null;
  }

  try {
    const config = await getConfig<LabourEpisodeConfig>(MODULE_NAME);
    const encounters = await fetchPatientEncounters(patientUuid);
    return selectLatestAncNumeric(encounters, conceptUuid, config, new Date());
  } catch (error) {
    console.error('Failed to load current-pregnancy ANC obstetric history', error);
    return null;
  }
}
