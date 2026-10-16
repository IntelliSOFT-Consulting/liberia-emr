import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import type { LabourEpisodeConfig } from '../forms/labour-episode.ts';
import {
  collectEncounterPages,
  decideTdGate,
  immunizationEncounterPagePath,
  isTdVaccine,
  tdConceptsFromFormArgs,
  type RestListPage,
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
    const [config, loaded] = await Promise.all([
      getConfig<LabourEpisodeConfig>(MODULE_NAME),
      fetchImmunizationEncounters(patientId),
    ]);
    return decideTdGate({
      patientId,
      birthDate,
      evaluationDate,
      vaccineConceptUuid,
      editingEncounterUuid,
      concepts,
      encounters: loaded.encounters,
      episodeConfig: config,
      historyComplete: loaded.complete,
    });
  } catch (error) {
    console.error('Failed to evaluate Td pregnancy eligibility', error);
    return 'unresolved';
  }
}

async function fetchImmunizationEncounters(patientId: string): Promise<{ encounters: TdHistoryEncounter[]; complete: boolean }> {
  return collectEncounterPages((startIndex, includeTotalCount) => fetchEncounterPage(patientId, startIndex, includeTotalCount));
}

async function fetchEncounterPage(
  patientId: string,
  startIndex: number,
  includeTotalCount: boolean,
): Promise<RestListPage<TdHistoryEncounter>> {
  const url = `${restBaseUrl}/${immunizationEncounterPagePath(patientId, startIndex, includeTotalCount)}`;
  const response = await openmrsFetch<RestListPage<TdHistoryEncounter>>(url);
  return response?.data ?? {};
}
