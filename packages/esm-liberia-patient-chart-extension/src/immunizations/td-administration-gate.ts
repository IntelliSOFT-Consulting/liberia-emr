import { fhirBaseUrl, getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import type { LabourEpisodeConfig } from '../forms/labour-episode.ts';
import { historyBelongsToPatient } from './pediatric-pfizer.ts';
import { loadHistory, sequenceHistoryUrls } from './load-history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import {
  decideTdGate,
  isTdVaccine,
  tdConceptsFromFormArgs,
  type TdGateCode,
  type TdHistoryEncounter,
} from './td-pregnancy.ts';

const MODULE_NAME = '@liberiaemr/esm-liberia-patient-chart-extension';

/**
 * Form-engine expression helper. Always returns a Promise so a calculateExpression
 * can chain `.then(code => code)`. Non-Td vaccines resolve to `allowed` without
 * reading the chart. Td failures resolve to `unresolved` and must not be given.
 *
 * Argument order is the Immunization form expression. Concept UUIDs are supplied
 * by that expression (`${var.*}`), not compiled into this module.
 */
export function tdAdministrationGate(
  patientId: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  pregnancyStatusConceptUuid: string,
  firstTrimesterUuid: string,
  secondTrimesterUuid: string,
  thirdTrimesterUuid: string,
  vaccineNameConceptUuid: string,
  td1: string,
  tt1: string,
  td2: string,
  tt2: string,
  td3: string,
  tt3: string,
  td4: string,
  tt4: string,
  td5: string,
  tt5: string,
): Promise<TdGateCode> {
  if (!isTdVaccine(vaccineConceptUuid, td1, td2, td3, td4, td5)) {
    return Promise.resolve('allowed');
  }
  if (!patientId?.trim()) {
    return Promise.resolve('unresolved');
  }
  const concepts = tdConceptsFromFormArgs(
    pregnancyStatusConceptUuid,
    firstTrimesterUuid,
    secondTrimesterUuid,
    thirdTrimesterUuid,
    vaccineNameConceptUuid,
    td1,
    tt1,
    td2,
    tt2,
    td3,
    tt3,
    td4,
    tt4,
    td5,
    tt5,
  );
  return loadTdGate(patientId, birthDate, evaluationDate, vaccineConceptUuid, editingEncounterUuid, concepts);
}

async function loadTdGate(
  patientId: string,
  birthDate: string,
  evaluationDate: string,
  vaccineConceptUuid: string,
  editingEncounterUuid: string,
  concepts: ReturnType<typeof tdConceptsFromFormArgs>,
): Promise<TdGateCode> {
  try {
    const urls = sequenceHistoryUrls(patientId, fhirBaseUrl, restBaseUrl);
    const [config, loaded] = await Promise.all([
      getConfig<LabourEpisodeConfig & { routineImmunizations: SequenceIdentityConfig }>(MODULE_NAME),
      loadHistory(urls.fhirUrl, urls.encounterUrl, async (url) => (await openmrsFetch(url)).data),
    ]);
    if (!historyBelongsToPatient(patientId, loaded.fhir, loaded.encounters)) {
      return 'unresolved';
    }
    // The wire shape genuinely has encounterDatetime/form/patient on every record; history.ts's
    // NationalEncounter marks them optional for its own defensive parsing, which is stricter than
    // TdHistoryEncounter needs here.
    return decideTdGate({
      patientId,
      birthDate,
      evaluationDate,
      vaccineConceptUuid,
      editingEncounterUuid,
      concepts,
      fhir: loaded.fhir,
      encounters: loaded.encounters as unknown as TdHistoryEncounter[],
      episodeConfig: config,
      config: config.routineImmunizations,
      historyComplete: true,
    });
  } catch (error) {
    console.error('Failed to evaluate Td pregnancy eligibility', error);
    return 'unresolved';
  }
}
