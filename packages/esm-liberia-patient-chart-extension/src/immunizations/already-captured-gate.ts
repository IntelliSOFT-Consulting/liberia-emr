import { fhirBaseUrl, getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import {
  evaluateAlreadyCapturedDoseFromChart,
  type AlreadyCapturedCode,
} from './already-captured.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

/**
 * Form-engine expression helper. Always returns a Promise so a calculateExpression
 * can chain `.then(code => code)`.
 *
 * `already-given` means this canonical dose is already in immunization history.
 * `unresolved` means that fact could not be checked and the save must stop.
 * Td, Pediatric Pfizer, and HPV resolve to `allowed` here. Their gates remain
 * the duplicate authority, and Pediatric Pfizer dose 1 keeps its history-outage
 * warning.
 */
export function alreadyCapturedVaccineGate(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
): Promise<AlreadyCapturedCode> {
  return loadAlreadyCapturedVaccineGate(
    patientUuid,
    birthDate,
    evaluationDate,
    vaccineConceptUuid,
    editingEncounterUuid,
  );
}

async function loadAlreadyCapturedVaccineGate(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
): Promise<AlreadyCapturedCode> {
  try {
    const config = await getConfig<{ routineImmunizations: SequenceIdentityConfig }>(MODULE_NAME);
    return await evaluateAlreadyCapturedDoseFromChart({
      patientUuid,
      birthDate,
      evaluationDate,
      vaccineConceptUuid,
      editingEncounterUuid,
      config: config.routineImmunizations,
      fhirBaseUrl,
      restBaseUrl,
      fetchPage: async (url) => (await openmrsFetch(url)).data,
    });
  } catch (error) {
    console.error('Failed to check whether this vaccine was already recorded', error);
    const vaccine = vaccineConceptUuid?.trim() ?? '';
    if (!vaccine) return 'allowed';
    return 'unresolved';
  }
}
