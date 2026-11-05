import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { vitaminAAdministrationsFromObs, type VitaminAConcepts } from './vitamin-a-supplementation';

const OBS_REP =
  'custom:(uuid,voided,value,obsDatetime,encounter:(uuid,encounterDatetime,obs:(uuid,voided,concept:(uuid),value)))';

/**
 * Loads child Vitamin A administrations recorded as Supplementary immunization
 * activities observations. Returns a JSON array, or the sentinel "error" when
 * history cannot be confirmed. Medication orders are not queried.
 */
export async function loadVitaminAAdministrations(
  patientUuid: string,
  supplementaryConceptUuid: string,
  dateReceivedConceptUuid: string,
  blueConceptUuid: string,
  redConceptUuid: string,
): Promise<string> {
  if (!patientUuid || !supplementaryConceptUuid || !dateReceivedConceptUuid || !blueConceptUuid || !redConceptUuid) {
    return 'error';
  }
  const concepts: VitaminAConcepts = {
    blue: blueConceptUuid,
    red: redConceptUuid,
    dateReceived: dateReceivedConceptUuid,
  };
  try {
    const url =
      `${restBaseUrl}/obs?patient=${encodeURIComponent(patientUuid)}` +
      `&concept=${encodeURIComponent(supplementaryConceptUuid)}` +
      `&limit=100&v=${OBS_REP}`;
    const response = await openmrsFetch<{ results?: unknown[] }>(url);
    const results = response?.data?.results ?? [];
    if (results.length >= 100) {
      return 'error';
    }
    const read = vitaminAAdministrationsFromObs(results, concepts);
    if (!read.complete) {
      return 'error';
    }
    return JSON.stringify(read.administrations);
  } catch (error) {
    console.error('Failed to load Vitamin A administration history', error);
    return 'error';
  }
}
