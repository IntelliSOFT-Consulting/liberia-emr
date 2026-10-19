import { fhirBaseUrl, getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import {
  evaluatePediatricPfizerAdministration,
  type PediatricPfizerGateCode,
} from './pediatric-pfizer.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

/**
 * Form-engine expression helper. Always returns a Promise so a calculateExpression
 * can chain `.then(code => code)`. Vaccines other than Pediatric Pfizer resolve
 * to `allowed` without reading the chart. Pediatric Pfizer failures resolve to
 * `unresolved` and must not be saved.
 *
 * The patient argument is the form's active patient. History is loaded for that
 * patient only, and a page or record for anyone else stays unresolved.
 */
export function pediatricPfizerAdministrationGate(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  dose1ConceptUuid: string,
  dose2ConceptUuid: string,
): Promise<PediatricPfizerGateCode> {
  return loadPediatricPfizerGate(
    patientUuid,
    birthDate,
    evaluationDate,
    vaccineConceptUuid,
    editingEncounterUuid,
    dose1ConceptUuid,
    dose2ConceptUuid,
  );
}

async function loadPediatricPfizerGate(
  patientUuid: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  dose1ConceptUuid: string,
  dose2ConceptUuid: string,
): Promise<PediatricPfizerGateCode> {
  try {
    const config = await getConfig<{ routineImmunizations: SequenceIdentityConfig }>(MODULE_NAME);
    return await evaluatePediatricPfizerAdministration({
      patientUuid,
      birthDate,
      evaluationDate,
      vaccineConceptUuid,
      editingEncounterUuid,
      dose1ConceptUuid,
      dose2ConceptUuid,
      config: config.routineImmunizations,
      fhirBaseUrl,
      restBaseUrl,
      fetchPage: async (url) => (await openmrsFetch(url)).data,
    });
  } catch (error) {
    console.error('Failed to evaluate Pediatric Pfizer eligibility', error);
    return 'unresolved';
  }
}
