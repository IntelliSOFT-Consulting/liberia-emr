import { fhirBaseUrl, getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { decideTtGate, type TtGateCode } from './anc-tt.ts';
import { historyBelongsToPatient } from './pediatric-pfizer.ts';
import { loadHistory, sequenceHistoryUrls } from './load-history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

/**
 * Form-engine expression helper for the ANC form's Date-of-TT1..TT5 questions.
 * Always returns a Promise so a calculateExpression can chain `.then(code => code)`.
 * An empty date resolves to `allowed` without reading the chart: there is nothing
 * to reconcile yet. `canonicalDoseId` is a literal `'TD1'`..`'TD5'` supplied by the
 * form expression for the specific question it is attached to, not a vaccine
 * concept lookup — each Date-of-TT field always represents exactly one dose.
 */
export function ttAdministrationGate(
  patientUuid: string,
  canonicalDoseId: string,
  ttDate: string,
  editingEncounterUuid: string,
): Promise<TtGateCode> {
  if (!ttDate?.trim()) {
    return Promise.resolve('allowed');
  }
  if (!patientUuid?.trim()) {
    return Promise.resolve('unresolved');
  }
  return loadTtGate(patientUuid, canonicalDoseId, ttDate, editingEncounterUuid);
}

async function loadTtGate(
  patientUuid: string,
  canonicalDoseId: string,
  ttDate: string,
  editingEncounterUuid: string,
): Promise<TtGateCode> {
  try {
    const urls = sequenceHistoryUrls(patientUuid, fhirBaseUrl, restBaseUrl);
    const [config, loaded] = await Promise.all([
      getConfig<{ routineImmunizations: SequenceIdentityConfig }>(MODULE_NAME),
      loadHistory(urls.fhirUrl, urls.encounterUrl, async (url) => (await openmrsFetch(url)).data),
    ]);
    if (!historyBelongsToPatient(patientUuid, loaded.fhir, loaded.encounters)) {
      return 'unresolved';
    }
    return decideTtGate({
      patientUuid,
      canonicalDoseId,
      ttDate,
      editingEncounterUuid,
      fhir: loaded.fhir,
      encounters: loaded.encounters,
      config: config.routineImmunizations,
    });
  } catch (error) {
    console.error('Failed to evaluate ANC Date-of-TT eligibility', error);
    return 'unresolved';
  }
}
