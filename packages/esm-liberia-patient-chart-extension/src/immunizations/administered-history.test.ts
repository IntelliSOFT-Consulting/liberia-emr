import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { administeredTimeline, consolidateHistory, timelineContextLabel, timelineVitaminALabel } from './history.ts';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { evaluateSequence } from './sequence.ts';

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const patientUuid = 'patient-1';

function propertiesOf(text: string) {
  const parsed = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    parsed.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return parsed;
}

function resolveTokens(value: unknown, parsed: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      const resolved = parsed.get(name);
      if (!resolved) throw new Error(`Unresolved ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item, parsed));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTokens(item, parsed)]));
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
const national = resolveTokens(
  frontendConfig[moduleName].routineImmunizations,
  properties,
) as SequenceIdentityConfig;

function concept(id: string) {
  const uuid = national.vaccineConceptUuids[id];
  assert.ok(uuid, id);
  return uuid;
}

function ttConcept(id: string) {
  const uuid = national.ancTtConceptUuids[id];
  assert.ok(uuid, id);
  return uuid;
}

function fhir(conceptUuid: string, date: string, id: string): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function vaccineEncounter(conceptUuid: string, date: string, obsId: string): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid },
    form: { uuid: national.nationalFormUuids[national.nationalFormUuids.length - 1] },
    encounterDatetime: date,
    obs: [{ uuid: obsId, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function ttEncounter(conceptUuid: string, date: string, obsId: string): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid }, form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
    encounterDatetime: '2020-01-01T00:00:00.000+0000',
    obs: [{ uuid: obsId, concept: { uuid: conceptUuid }, value: date }],
  };
}

function timeline(fhirRecords: FhirImmunization[] = [], encounters: NationalEncounter[] = []) {
  return administeredTimeline({ patientUuid, fhir: fhirRecords, encounters, config: national });
}

describe('administered timeline', () => {
  it('lists a FHIR-recorded childhood dose with its real administration date', () => {
    const result = timeline([fhir(concept('OPV1'), '2024-03-01', 'fhir-opv1')]);
    assert.equal(result.unresolved, false);
    assert.deepEqual(result.entries.map((entry) => [entry.canonicalDoseId, entry.administeredDate]), [
      ['OPV1', '2024-03-01'],
    ]);
    assert.equal(result.entries[0].recordIds[0].startsWith('fhir:'), true);
  });

  it('lists TD, HPV, and Pediatric Pfizer doses, which are not in the routine schedule', () => {
    const result = timeline([
      fhir(concept('TD2'), '2024-01-01', 'fhir-td2'),
      fhir(concept('HPV1'), '2024-02-01', 'fhir-hpv1'),
      fhir(concept('PediatricPfizer1'), '2024-03-01', 'fhir-pfizer1'),
    ]);
    assert.equal(result.unresolved, false);
    const byDose = new Map(result.entries.map((entry) => [entry.canonicalDoseId, entry.administeredDate]));
    assert.equal(byDose.get('TD2'), '2024-01-01');
    assert.equal(byDose.get('HPV1'), '2024-02-01');
    assert.equal(byDose.get('PediatricPfizer1'), '2024-03-01');
  });

  it('shows one entry, not two, when ANC TT and Immunization Td record the same dose and date', () => {
    const result = timeline([], [
      ttEncounter(ttConcept('TD3'), '2024-04-01', 'tt3-obs'),
      vaccineEncounter(concept('TD3'), '2024-04-01T10:00:00.000Z', 'td3-obs'),
    ]);
    assert.equal(result.unresolved, false);
    const td3Entries = result.entries.filter((entry) => entry.canonicalDoseId === 'TD3');
    assert.equal(td3Entries.length, 1);
    assert.equal(td3Entries[0].administeredDate, '2024-04-01');
    // Provenance for both underlying records is preserved even though it displays as one event.
    assert.equal(td3Entries[0].recordIds.some((id) => id.startsWith('anc-tt:')), true);
    assert.equal(td3Entries[0].recordIds.some((id) => id.startsWith('national-form:')), true);
  });

  it('sorts newest administration first, across both readers, and is stable by dose id on a tie', () => {
    const result = timeline([
      fhir(concept('TD1'), '2024-01-01', 'fhir-td1'),
    ], [
      vaccineEncounter(concept('OPV1'), '2024-03-01T00:00:00.000Z', 'opv1-obs'),
      vaccineEncounter(concept('Penta1'), '2024-03-01T00:00:00.000Z', 'penta1-obs'),
    ]);
    assert.deepEqual(result.entries.map((entry) => entry.canonicalDoseId), ['OPV1', 'Penta1', 'TD1']);
  });

  it('marks the timeline unresolved on a tetanus date conflict, without hiding unrelated doses', () => {
    const result = timeline([], [
      ttEncounter(ttConcept('TD1'), '2024-01-01', 'tt1-a'),
      vaccineEncounter(concept('TD1'), '2024-02-01T00:00:00.000Z', 'td1-b'),
      vaccineEncounter(concept('OPV1'), '2024-03-01T00:00:00.000Z', 'opv1-obs'),
    ]);
    assert.equal(result.unresolved, true);
    assert.deepEqual(result.entries.map((entry) => entry.canonicalDoseId), ['OPV1']);
  });

  it('returns no entries and is not unresolved for a patient with no administered doses', () => {
    const result = timeline();
    assert.deepEqual(result.entries, []);
    assert.equal(result.unresolved, false);
  });

  it('omits a routine-schedule dose entirely, rather than guessing, when it has two conflicting administration dates', () => {
    // Regression for the liberia-review blocker: normalizeHistory flags a conflicting-date
    // dose as an issue but does not remove it from its own doses array, so administeredTimeline
    // must filter it itself rather than display both dates under one canonicalDoseId.
    const result = timeline([], [
      vaccineEncounter(concept('OPV1'), '2024-01-01T00:00:00.000Z', 'opv1-a'),
      vaccineEncounter(concept('OPV1'), '2024-03-01T00:00:00.000Z', 'opv1-b'),
    ]);
    assert.equal(result.unresolved, true);
    assert.equal(result.entries.some((entry) => entry.canonicalDoseId === 'OPV1'), false);
    assert.deepEqual(result.entries, []);
    // No duplicate logical OPV1 row under either date, and no two entries sharing one dose id.
    const doseIds = result.entries.map((entry) => entry.canonicalDoseId);
    assert.deepEqual(doseIds, [...new Set(doseIds)]);
  });

  it('still coalesces a routine-schedule dose normally when both sources agree on the same date', () => {
    const result = timeline([
      fhir(concept('OPV1'), '2024-01-01', 'fhir-opv1'),
    ], [
      vaccineEncounter(concept('OPV1'), '2024-01-01T00:00:00.000Z', 'opv1-form'),
    ]);
    assert.equal(result.unresolved, false);
    const opv1Entries = result.entries.filter((entry) => entry.canonicalDoseId === 'OPV1');
    assert.equal(opv1Entries.length, 1);
    assert.equal(opv1Entries[0].administeredDate, '2024-01-01');
    assert.equal(opv1Entries[0].administrationContext, 'routine');
  });
});

describe('SIA Vitamin A on the administered timeline', () => {
  const siaConfig = national.supplementaryImmunization;
  assert.ok(siaConfig);

  function siaEncounter(input: {
    obsId: string;
    strength: 'blue' | 'red';
    date: string;
    context?: 'sia' | 'routine' | 'missing';
    encounterId?: string;
  }): NationalEncounter {
    const strengthUuid = input.strength === 'blue' ? siaConfig!.blueConceptUuid : siaConfig!.redConceptUuid;
    const contextUuid = input.context === 'routine'
      ? siaConfig!.routineAnswerConceptUuid
      : siaConfig!.siaAnswerConceptUuid;
    const obs: NationalEncounter['obs'] = [
      { uuid: input.obsId, concept: { uuid: siaConfig!.activitiesConceptUuid }, value: { uuid: strengthUuid } },
      { uuid: `${input.obsId}-date`, concept: { uuid: siaConfig!.dateReceivedConceptUuid }, value: input.date },
    ];
    if (input.context !== 'missing') {
      obs!.push({
        uuid: `${input.obsId}-context`,
        concept: { uuid: siaConfig!.administrationContextConceptUuid },
        value: { uuid: contextUuid },
      });
    }
    return {
      uuid: input.encounterId ?? `enc-${input.obsId}`,
      patient: { uuid: patientUuid },
      form: { uuid: national.nationalFormUuids[national.nationalFormUuids.length - 1] },
      encounterDatetime: `${input.date}T10:00:00.000Z`,
      obs,
    };
  }

  it('shows Vitamin A Blue with the administration date and an explicit SIA context', () => {
    const result = timeline([], [
      vaccineEncounter(concept('OPV1'), '2024-06-15T10:00:00.000Z', 'opv1-obs'),
      siaEncounter({ obsId: 'vita-blue', strength: 'blue', date: '2024-06-15' }),
    ]);
    assert.equal(result.unresolved, false);
    const opv = result.entries.find((entry) => entry.canonicalDoseId === 'OPV1');
    const blue = result.entries.find((entry) => entry.vitaminAStrength === 'blue');
    assert.ok(opv);
    assert.equal(opv.administrationContext, 'routine');
    assert.equal(opv.administeredDate, '2024-06-15');
    assert.ok(blue);
    assert.equal(blue.administrationContext, 'sia');
    assert.equal(blue.administeredDate, '2024-06-15');
    assert.equal(blue.sequenceNumber, null);
    assert.equal(timelineVitaminALabel(blue.vitaminAStrength!), 'Vitamin A Blue 100,000 IU');
    assert.equal(timelineContextLabel(blue.administrationContext), 'SIA');
    assert.equal(timelineContextLabel(opv.administrationContext), 'Routine');
    assert.notEqual(timelineVitaminALabel(blue.vitaminAStrength!), blue.canonicalDoseId);
  });

  it('keeps a routine vaccine sequence unchanged when an SIA Vitamin A record is present', () => {
    const birthDate = '2020-01-01';
    const evaluationDate = '2024-06-15';
    const sia = siaEncounter({ obsId: 'vita-red', strength: 'red', date: '2024-06-01' });
    const without = evaluateSequence({
      patientUuid, doseId: 'OPV1', birthDate, evaluationDate, fhir: [], encounters: [], config: national,
    });
    const withSia = evaluateSequence({
      patientUuid, doseId: 'OPV1', birthDate, evaluationDate, fhir: [], encounters: [sia], config: national,
    });
    assert.equal(withSia.status, without.status);
    assert.notEqual(withSia.status, 'ADMINISTERED');
    const nextWithout = evaluateSequence({
      patientUuid, doseId: 'OPV2', birthDate, evaluationDate, fhir: [], encounters: [], config: national,
    });
    const nextWithSia = evaluateSequence({
      patientUuid, doseId: 'OPV2', birthDate, evaluationDate, fhir: [], encounters: [sia], config: national,
    });
    assert.equal(nextWithSia.status, 'WAITING_FOR_PREREQUISITE');
    assert.equal(nextWithSia.status, nextWithout.status);
    const history = consolidateHistory({
      patientUuid,
      fhir: [],
      encounters: [sia, vaccineEncounter(concept('Penta1'), '2024-03-01T00:00:00.000Z', 'penta1-obs')],
      config: national,
    });
    assert.deepEqual(history.doses.map((dose) => dose.vaccineConceptUuid), [concept('Penta1')]);
  });

  it('coalesces duplicate SIA documentation and keeps separate administrations', () => {
    const result = timeline([], [
      siaEncounter({ obsId: 'blue-a', strength: 'blue', date: '2024-07-15', encounterId: 'enc-a' }),
      siaEncounter({ obsId: 'blue-b', strength: 'blue', date: '2024-07-15', encounterId: 'enc-b' }),
      siaEncounter({ obsId: 'blue-later', strength: 'blue', date: '2024-08-15', encounterId: 'enc-later' }),
      siaEncounter({ obsId: 'red-same-day', strength: 'red', date: '2024-07-15', encounterId: 'enc-red' }),
      siaEncounter({
        obsId: 'blue-routine', strength: 'blue', date: '2024-07-15', context: 'routine', encounterId: 'enc-routine',
      }),
    ]);
    assert.equal(result.unresolved, false);
    const sameDaySia = result.entries.filter((entry) =>
      entry.vitaminAStrength === 'blue' && entry.administrationContext === 'sia' && entry.administeredDate === '2024-07-15');
    assert.equal(sameDaySia.length, 1);
    assert.deepEqual(sameDaySia[0].recordIds, ['national-form:blue-a', 'national-form:blue-b']);
    assert.equal(result.entries.filter((entry) => entry.vitaminAStrength === 'blue' && entry.administrationContext === 'sia').length, 2);
    const red = result.entries.find((entry) => entry.vitaminAStrength === 'red' && entry.administrationContext === 'sia');
    assert.ok(red);
    assert.equal(red.administeredDate, '2024-07-15');
    assert.equal(timelineVitaminALabel(red.vitaminAStrength!), 'Vitamin A Red 200,000 IU');
    assert.equal(timelineContextLabel(red.administrationContext), 'SIA');
    const routineVitaminA = result.entries.find((entry) =>
      entry.vitaminAStrength === 'blue' && entry.administrationContext === 'routine');
    assert.ok(routineVitaminA);
    assert.equal(routineVitaminA.administeredDate, '2024-07-15');
    assert.equal(timelineContextLabel(routineVitaminA.administrationContext), 'Routine');
  });

  it('does not treat a Vitamin A observation without the SIA marker as an SIA dose', () => {
    const result = timeline([], [
      siaEncounter({ obsId: 'historical', strength: 'blue', date: '2024-07-15', context: 'missing' }),
      vaccineEncounter(concept('OPV1'), '2024-03-01T00:00:00.000Z', 'opv1-obs'),
    ]);
    assert.equal(result.unresolved, false);
    assert.equal(result.entries.some((entry) => entry.vitaminAStrength), false);
    assert.equal(result.entries[0].canonicalDoseId, 'OPV1');
    assert.equal(result.entries[0].administrationContext, 'routine');
  });

  it('renders context from the timeline field', () => {
    const source = readFileSync(new URL('./routine-schedule.extension.tsx', import.meta.url), 'utf8');
    assert.match(source, /timelineContextLabel\(entry\.administrationContext\)/);
    assert.match(source, /timelineVitaminALabel\(entry\.vitaminAStrength\)/);
    assert.doesNotMatch(source, /entry\.canonicalDoseId\.includes\('SIA'\)|label\.includes\('SIA'\)/);
  });
});
