import { fhirBaseUrl, getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { evaluateHpvAdministration, type HpvGateCode } from './hpv.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

/**
 * Form-engine expression helper. Always returns a Promise so a calculateExpression
 * can chain `.then(code => code)`. Vaccines other than HPV resolve to `allowed`
 * without reading the chart. A patient whose gender is not `female` or `f`
 * after lower-casing resolves to `not-female`. Age, sequence, duplicate, and history results come from
 * evaluateSequence. History that cannot be loaded fails closed, except an HPV1
 * decision that is already too young or too old from the birth date alone.
 *
 * `gender` is patient.gender as Form Engine received it. It is not inferred
 * from any other patient field.
 */
export function hpvAdministrationGate(
  patientUuid: string,
  gender: unknown,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  hpv1ConceptUuid: string,
  hpv2ConceptUuid: string,
): Promise<HpvGateCode> {
  return loadHpvGate(
    patientUuid,
    gender,
    birthDate,
    evaluationDate,
    vaccineConceptUuid,
    editingEncounterUuid,
    hpv1ConceptUuid,
    hpv2ConceptUuid,
  );
}

async function loadHpvGate(
  patientUuid: string,
  gender: unknown,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  hpv1ConceptUuid: string,
  hpv2ConceptUuid: string,
): Promise<HpvGateCode> {
  try {
    const config = await getConfig<{ routineImmunizations: SequenceIdentityConfig }>(MODULE_NAME);
    return await evaluateHpvAdministration({
      patientUuid,
      gender,
      birthDate,
      evaluationDate,
      vaccineConceptUuid,
      editingEncounterUuid,
      hpv1ConceptUuid,
      hpv2ConceptUuid,
      config: config.routineImmunizations,
      fhirBaseUrl,
      restBaseUrl,
      fetchPage: async (url) => (await openmrsFetch(url)).data,
    });
  } catch (error) {
    console.error('Failed to evaluate HPV eligibility', error);
    return 'unresolved';
  }
}
