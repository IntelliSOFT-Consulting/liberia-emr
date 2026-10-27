import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { administeredTimeline, encountersOmittingEditingVaccine, normalizeHistory, type NationalEncounter } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const patientUuid = 'patient';

function propertiesOf(text: string) {
  const properties = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return properties;
}

function resolveTokens(value: unknown, properties: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      const resolved = properties.get(name);
      if (!resolved) throw new Error(`Unresolved ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item, properties));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTokens(item, properties)]));
  }
  return value;
}

const properties = propertiesOf(readFileSync(new URL(
  '../../../../content-packages/content-liberia-national/configuration/variables.properties',
  import.meta.url,
), 'utf8'));
const frontendConfig = JSON.parse(readFileSync(new URL(
  '../../../../content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json',
  import.meta.url,
), 'utf8'));
const configured = resolveTokens(frontendConfig[moduleName].routineImmunizations, properties) as SequenceIdentityConfig;
const formUuid = properties.get('var.form.immunization.uuid')!;
const groupConcept = properties.get('var.concept.national.vaccine-administration.uuid')!;
const intradermal = 'route-intradermal';
const oral = 'route-oral';

function vaccine(uuid: string, conceptUuid: string) {
  return { uuid, concept: { uuid: configured.vaccineQuestionUuid }, value: { uuid: conceptUuid } };
}

function route(uuid: string, conceptUuid: string) {
  return { uuid, concept: { uuid: configured.routeQuestionUuid }, value: { uuid: conceptUuid } };
}

function returnDate(uuid: string, value: string) {
  return { uuid, concept: { uuid: configured.returnDateQuestionUuid }, value };
}

function encounter(obs: NationalEncounter['obs'], datetime = '2024-01-31T10:00:00.000Z'): NationalEncounter {
  return { uuid: 'birth-visit', patient: { uuid: patientUuid }, form: { uuid: formUuid }, encounterDatetime: datetime, obs };
}

function group(uuid: string, members: NonNullable<NationalEncounter['obs']>) {
  return { uuid, concept: { uuid: groupConcept }, groupMembers: members };
}

function doses(encounters: NationalEncounter[]) {
  return normalizeHistory({
    patientUuid,
    fhir: [],
    encounters,
    nationalFormUuids: configured.nationalFormUuids,
    vaccineQuestionUuid: configured.vaccineQuestionUuid,
    vaccineConceptUuids: configured.vaccineConceptUuids,
  });
}

function timeline(encounters: NationalEncounter[]) {
  return administeredTimeline({ patientUuid, fhir: [], encounters, config: configured });
}

describe('grouped and legacy immunization history', () => {
  const bcg = configured.vaccineConceptUuids.BCG;
  const opv0 = configured.vaccineConceptUuids.OPV0;

  it('reads grouped encounters recorded on frozen v1.10 and the current form', () => {
    const frozen = properties.get('var.form.immunization.v1-10.uuid');
    assert.equal(frozen, '94f8fe92-b48c-3d44-a133-c572fa0b17bd');
    assert.notEqual(frozen, formUuid);
    assert.equal(configured.nationalFormUuids.includes(frozen!), true);
    assert.equal(configured.nationalFormUuids.includes(formUuid), true);
    for (const recordedForm of [frozen, formUuid]) {
      const history = doses([{
        ...encounter([
          group('group-bcg', [vaccine('obs-bcg', bcg)]),
          group('group-opv', [vaccine('obs-opv', opv0)]),
        ]),
        form: { uuid: recordedForm },
      }]);
      assert.deepEqual(history.issues, []);
      assert.deepEqual(history.doses.map((dose) => dose.canonicalDoseId), ['BCG', 'OPV0']);
    }
  });

  it('reads two administrations from one encounter without collapsing them', () => {
    const history = doses([encounter([
      group('group-bcg', [
        vaccine('obs-bcg', bcg),
        route('route-bcg', intradermal),
        returnDate('return-bcg', '2024-02-28T12:00:00.000Z'),
      ]),
      group('group-opv', [
        vaccine('obs-opv', opv0),
        route('route-opv', oral),
        returnDate('return-opv', '2024-03-13T12:00:00.000Z'),
      ]),
    ])]);
    assert.deepEqual(history.issues, []);
    assert.deepEqual(history.doses.map((dose) => [dose.canonicalDoseId, dose.records.map((record) => record.recordId)]), [
      ['BCG', ['national-form:obs-bcg']],
      ['OPV0', ['national-form:obs-opv']],
    ]);
    const rows = timeline([encounter([
      group('group-bcg', [
        vaccine('obs-bcg', bcg),
        route('route-bcg', intradermal),
        returnDate('return-bcg', '2024-02-28T12:00:00.000Z'),
      ]),
      group('group-opv', [
        vaccine('obs-opv', opv0),
        route('route-opv', oral),
        returnDate('return-opv', '2024-03-13T12:00:00.000Z'),
      ]),
    ])]);
    assert.equal(rows.unresolved, false);
    const shown = rows.entries.filter((entry) => entry.canonicalDoseId === 'BCG' || entry.canonicalDoseId === 'OPV0');
    assert.deepEqual(shown.map((entry) => [entry.canonicalDoseId, entry.routeConceptUuid, entry.returnDate, entry.recordIds]), [
      ['BCG', intradermal, '2024-02-28', ['national-form:obs-bcg']],
      ['OPV0', oral, '2024-03-13', ['national-form:obs-opv']],
    ]);
  });

  it('still reads one legacy ungrouped administration, including its route and return date', () => {
    const legacy = encounter([
      vaccine('obs-bcg', bcg),
      route('route-bcg', intradermal),
      returnDate('return-bcg', '2024-02-28T12:00:00.000Z'),
    ]);
    const history = doses([legacy]);
    assert.equal(history.doses.length, 1);
    assert.equal(history.doses[0].canonicalDoseId, 'BCG');
    assert.deepEqual(history.doses[0].records.map((record) => record.recordId), ['national-form:obs-bcg']);
    const rows = timeline([legacy]);
    const shown = rows.entries.find((entry) => entry.canonicalDoseId === 'BCG');
    assert.equal(shown?.routeConceptUuid, intradermal);
    assert.equal(shown?.returnDate, '2024-02-28');
  });

  it('reads one grouped vaccine as one administration', () => {
    const history = doses([encounter([
      group('group-bcg', [vaccine('obs-bcg', bcg), route('route-bcg', intradermal)]),
    ])]);
    assert.equal(history.doses.length, 1);
    assert.deepEqual(history.doses[0].records.map((record) => record.recordId), ['national-form:obs-bcg']);
  });

  it('drops only the grouped vaccine being edited and keeps the sibling group', () => {
    const birth = encounter([
      group('group-bcg', [
        vaccine('obs-bcg', bcg),
        route('route-bcg', intradermal),
        returnDate('return-bcg', '2024-02-28T12:00:00.000Z'),
      ]),
      group('group-opv', [
        vaccine('obs-opv', opv0),
        route('route-opv', oral),
        returnDate('return-opv', '2024-03-13T12:00:00.000Z'),
      ]),
    ]);
    const vaccineAnswers = (encounters: NationalEncounter[]) => encounters.flatMap((item) =>
      (item.obs ?? []).flatMap((group) => (group.groupMembers ?? [])
        .filter((member) => member.concept?.uuid === configured.vaccineQuestionUuid)
        .map((member) => (member.value as { uuid?: string }).uuid)));
    const editingBcg = encountersOmittingEditingVaccine(
      [birth], birth.uuid, configured.vaccineQuestionUuid, bcg,
    );
    assert.deepEqual(vaccineAnswers(editingBcg), [opv0]);
    assert.equal(editingBcg[0].obs?.find((group) => group.uuid === 'group-opv')?.groupMembers?.length, 3);
    const editingOpv = encountersOmittingEditingVaccine(
      [birth], birth.uuid, configured.vaccineQuestionUuid, opv0,
    );
    assert.deepEqual(vaccineAnswers(editingOpv), [bcg]);
    assert.equal(editingOpv[0].obs?.find((group) => group.uuid === 'group-bcg')?.groupMembers?.length, 3);
  });

  it('coalesces two saved copies of the same dose on the same date and keeps a different dose', () => {
    const history = doses([encounter([
      group('group-bcg-1', [vaccine('obs-bcg-1', bcg)]),
      group('group-bcg-2', [vaccine('obs-bcg-2', bcg)]),
      group('group-opv', [vaccine('obs-opv', opv0)]),
    ])]);
    const bcgDose = history.doses.find((dose) => dose.canonicalDoseId === 'BCG');
    const opvDose = history.doses.find((dose) => dose.canonicalDoseId === 'OPV0');
    assert.deepEqual(bcgDose?.records.map((record) => record.recordId).sort(), ['national-form:obs-bcg-1', 'national-form:obs-bcg-2']);
    assert.deepEqual(opvDose?.records.map((record) => record.recordId), ['national-form:obs-opv']);
  });
});
