import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { addDateOffset } from './eligibility.ts';
import { evaluateRoutineSchedule, routineSchedule } from './routine-schedule.ts';
import { normalizeHistory, duplicateRecordIds,
  type FhirImmunization, type NationalEncounter } from './history.ts';
import { clinicalDate } from './clinical-date.ts';
import { loadHistory } from './load-history.ts';
import routes from '../routes.json' with { type: 'json' };

const birthDate = '2024-01-31';
const patientUuid = 'patient';
const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const uuidLiteral = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const vaccineVariables: Record<string, string> = {
  BCG: 'var.concept.national.bcg.uuid',
  OPV0: 'var.concept.national.opv0-1-dose.uuid',
  OPV1: 'var.concept.national.opv1.uuid',
  Penta1: 'var.concept.national.penta-1.uuid',
  Pneumo1: 'var.concept.national.pneumo-1.uuid',
  Rota1: 'var.concept.national.rota-1.uuid',
  OPV2: 'var.concept.national.opv2.uuid',
  Penta2: 'var.concept.national.penta-2.uuid',
  Pneumo2: 'var.concept.national.pneumo-2.uuid',
  Rota2: 'var.concept.national.rota-2.uuid',
  OPV3: 'var.concept.national.opv3.uuid',
  Penta3: 'var.concept.national.penta-3.uuid',
  Pneumo3: 'var.concept.national.pneumo-3.uuid',
  Malaria1: 'var.concept.national.malaria-vaccine-dose-1.uuid',
  Malaria2: 'var.concept.national.malaria-vaccine-dose-2.uuid',
  Malaria3: 'var.concept.national.malaria-vaccine-dose-3.uuid',
  MCV1: 'var.concept.national.mcv1.uuid',
  TCV: 'var.concept.national.tcv.uuid',
  YellowFever: 'var.concept.national.yellow-fever.uuid',
  MCV2: 'var.concept.national.mcv2.uuid',
  Malaria4: 'var.concept.national.malaria-vaccine-dose-4.uuid',
};

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

const properties = propertiesOf(readFileSync(new URL('../../../../content-packages/content-liberia-national/configuration/variables.properties', import.meta.url), 'utf8'));
const frontendConfig = JSON.parse(readFileSync(new URL('../../../../content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json', import.meta.url), 'utf8'));
const configured = resolveTokens(frontendConfig[moduleName].routineImmunizations, properties) as {
  nationalFormUuids: string[];
  vaccineQuestionUuid: string;
  vaccineConceptUuids: Record<string, string>;
};
const currentFormUuid = properties.get('var.form.immunization.uuid')!;
const day = (days: number) => addDateOffset(birthDate, { value: days, unit: 'days' });
const month = (months: number) => addDateOffset(birthDate, { value: months, unit: 'months' });
const dose = (id: string) => routineSchedule.find((d) => d.id === id)!;
function fhir(id: string, date: string, recordId = id, conceptUuid = configured.vaccineConceptUuids[id]): FhirImmunization {
  return { resourceType: 'Immunization', id: recordId, status: 'completed', patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: conceptUuid }] }, occurrenceDateTime: date };
}
function national(id: string, date: string, conceptUuid = configured.vaccineConceptUuids[id], formUuid = currentFormUuid): NationalEncounter {
  return { uuid: 'encounter', patient: { uuid: patientUuid }, form: { uuid: formUuid }, encounterDatetime: date,
    obs: [{ uuid: id, concept: { uuid: configured.vaccineQuestionUuid }, value: { uuid: conceptUuid } }] };
}
function normalized(
  records: FhirImmunization[] = [],
  encounters: NationalEncounter[] = [],
  overrides: Partial<Parameters<typeof normalizeHistory>[0]> = {},
) {
  return normalizeHistory({
    patientUuid,
    fhir: records,
    encounters,
    nationalFormUuids: configured.nationalFormUuids,
    vaccineQuestionUuid: configured.vaccineQuestionUuid,
    vaccineConceptUuids: configured.vaccineConceptUuids,
    ...overrides,
  });
}
function evaluate(id: string, date: string, records: FhirImmunization[] = [], encounters: NationalEncounter[] = [],
  vaccineConceptUuids: Readonly<Record<string, string>> = configured.vaccineConceptUuids) {
  return evaluateRoutineSchedule(birthDate, date, normalized(records, encounters, { vaccineConceptUuids }), vaccineConceptUuids)
    .find((r) => r.dose.id === id)!;
}
function prerequisite(id: string): FhirImmunization[] {
  const priorId = dose(id).prerequisite?.canonicalDoseId;
  if (!priorId) return [];
  const previous = dose(priorId);
  return [fhir(previous.id, addDateOffset(birthDate, previous.dueAge))];
}

describe('LE-559 DOB schedule', () => {
  it('uses distinct released national dose concepts', () => {
    assert.equal(routineSchedule.length, 21);
    assert.equal(new Set(routineSchedule.map((d) => d.id)).size, 21);
    for (const id of routineSchedule.map((d) => d.id)) assert.ok(configured.vaccineConceptUuids[id], id);
    assert.equal(new Set(Object.values(configured.vaccineConceptUuids)).size, Object.keys(configured.vaccineConceptUuids).length);
    for (const rule of routineSchedule) {
      assert.equal(configured.vaccineConceptUuids[rule.id], properties.get(vaccineVariables[rule.id]));
      assert.match(configured.vaccineConceptUuids[rule.id], uuidLiteral);
    }
  });
  for (const id of ['OPV1', 'Penta1', 'Pneumo1', 'Rota1']) {
    it(`${id}: 5w6d / 6w / 6w1d`, () => {
      assert.equal(evaluate(id, day(41)).status, 'NOT_YET_DUE');
      assert.equal(evaluate(id, day(42)).status, 'DUE');
      assert.equal(evaluate(id, day(43)).status, 'OVERDUE');
      assert.equal(evaluate(id, day(43)).canAdminister, true);
    });
  }
  for (const scheduled of routineSchedule.filter((d) => d.dueAge.value > 0)) {
    it(`${scheduled.id}: exact ${scheduled.dueAge.value} ${scheduled.dueAge.unit} boundary`, () => {
      const exact = addDateOffset(birthDate, scheduled.dueAge);
      const before = new Date(`${exact}T00:00:00Z`);
      before.setUTCDate(before.getUTCDate() - 1);
      assert.equal(evaluate(scheduled.id, before.toISOString().slice(0, 10), prerequisite(scheduled.id)).status, 'NOT_YET_DUE');
      assert.equal(evaluate(scheduled.id, exact, prerequisite(scheduled.id)).status, 'DUE');
    });
  }
  it('BCG is eligible at birth and 10 months, outside exactly at 11 calendar months', () => {
    for (const date of [birthDate, month(10), '2024-12-30']) assert.equal(evaluate('BCG', date).canAdminister, true);
    assert.equal(evaluate('BCG', month(11)).status, 'OUTSIDE_ELIGIBILITY_WINDOW');
  });
  it('OPV0 includes birth through day 7 and never catches up on day 8', () => {
    for (let n = 0; n <= 7; n++) assert.equal(evaluate('OPV0', day(n)).canAdminister, true);
    for (const n of [8, 42, 365]) {
      assert.equal(evaluate('OPV0', day(n)).status, 'OUTSIDE_ELIGIBILITY_WINDOW');
      assert.equal(evaluate('OPV0', day(n)).canAdminister, false);
    }
  });
  it('OPV2 requires actual OPV1 date + 28 days', () => {
    assert.equal(evaluate('OPV2', day(70)).status, 'WAITING_FOR_PREREQUISITE');
    assert.equal(evaluate('OPV2', day(70), [fhir('OPV1', day(42))]).status, 'DUE');
    const late = [fhir('OPV1', day(56))];
    assert.equal(evaluate('OPV2', day(70), late).status, 'WAITING_FOR_INTERVAL');
    assert.equal(evaluate('OPV2', day(70), late).eligibleDate, day(84));
    assert.equal(evaluate('OPV2', day(83), late).canAdminister, false);
    assert.equal(evaluate('OPV2', day(84), late).status, 'DUE');
    assert.equal(evaluate('OPV2', day(85), late).status, 'OVERDUE');
  });
  it('missed Penta1 stays available at 11 weeks even if a later dose was recorded', () => {
    assert.equal(evaluate('Penta1', day(77)).status, 'OVERDUE');
    assert.equal(evaluate('Penta1', day(77), [fhir('Penta2', day(70))]).status, 'OVERDUE');
  });
  it('late predecessors without an explicit interval do not move the scheduled eligible date', () => {
    const result = evaluate('Penta2', day(100), [fhir('Penta1', day(100))]);
    assert.equal(result.status, 'OVERDUE');
    assert.equal(result.eligibleDate, day(70));
  });
  for (const scheduled of routineSchedule.filter((d) => d.prerequisite)) {
    it(`${scheduled.id} requires its explicit predecessor`, () => {
      const exact = addDateOffset(birthDate, scheduled.dueAge);
      assert.equal(evaluate(scheduled.id, exact).status, 'WAITING_FOR_PREREQUISITE');
      const previous = dose(scheduled.prerequisite!.canonicalDoseId);
      if (scheduled.id !== 'OPV2') assert.equal(evaluate(scheduled.id, exact, [fhir(previous.id, exact)]).canAdminister, true);
    });
  }
  it('schedules each Malaria dose by age with no predecessor, interval, or upper cutoff', () => {
    const malaria = ['Malaria1', 'Malaria2', 'Malaria3', 'Malaria4'];
    for (const id of malaria) {
      assert.equal(dose(id).prerequisite, undefined);
      assert.equal(dose(id).upperAge, undefined);
      assert.equal(evaluate(id, month(240)).status, 'OVERDUE');
      assert.equal(evaluate(id, month(240)).canAdminister, true);
    }
    assert.equal(evaluate('Malaria1', month(4)).status, 'NOT_YET_DUE');
    assert.equal(evaluate('Malaria1', month(5)).status, 'DUE');
    const statuses = (months: number) => {
      const rows = evaluateRoutineSchedule(birthDate, month(months), normalized(), configured.vaccineConceptUuids);
      return Object.fromEntries(malaria.map((id) => {
        const row = rows.find((item) => item.dose.id === id)!;
        return [id, row.status];
      }));
    };
    assert.deepEqual(statuses(6), { Malaria1: 'OVERDUE', Malaria2: 'DUE', Malaria3: 'NOT_YET_DUE', Malaria4: 'NOT_YET_DUE' });
    assert.deepEqual(statuses(7), { Malaria1: 'OVERDUE', Malaria2: 'OVERDUE', Malaria3: 'DUE', Malaria4: 'NOT_YET_DUE' });
    assert.deepEqual(statuses(18), { Malaria1: 'OVERDUE', Malaria2: 'OVERDUE', Malaria3: 'OVERDUE', Malaria4: 'DUE' });
    for (const id of ['Malaria1', 'Malaria2', 'Malaria3']) {
      assert.equal(evaluate(id, month(18)).canAdminister, true);
    }
    assert.equal(evaluate('Malaria1', month(6), [fhir('Malaria2', month(6))]).status, 'OVERDUE');
    assert.equal(evaluate('Malaria4', month(18)).status, 'DUE');
  });
  it('keeps the approved non-Malaria predecessor and OPV interval rules', () => {
    const predecessor = (id: string) => dose(id).prerequisite!.canonicalDoseId;
    assert.deepEqual(['OPV2', 'Penta2', 'Pneumo2', 'Rota2', 'OPV3', 'Penta3', 'Pneumo3', 'MCV2'].map((id) => [id, predecessor(id)]), [
      ['OPV2', 'OPV1'], ['Penta2', 'Penta1'], ['Pneumo2', 'Pneumo1'], ['Rota2', 'Rota1'],
      ['OPV3', 'OPV2'], ['Penta3', 'Penta2'], ['Pneumo3', 'Pneumo2'], ['MCV2', 'MCV1'],
    ]);
    assert.deepEqual(routineSchedule.filter((d) => d.prerequisite).map((d) => d.id),
      ['OPV2', 'Penta2', 'Pneumo2', 'Rota2', 'OPV3', 'Penta3', 'Pneumo3', 'MCV2']);
    assert.deepEqual(dose('OPV2').prerequisite!.minimumInterval, { value: 28, unit: 'days' });
  });
  it('has no unspecified minimum intervals or upper catch-up ages', () => {
    assert.deepEqual(routineSchedule.filter((d) => d.upperAge).map((d) => d.id), ['BCG', 'OPV0']);
    assert.deepEqual(routineSchedule.filter((d) => d.prerequisite?.minimumInterval).map((d) => d.id), ['OPV2']);
    for (const scheduled of routineSchedule.filter((d) => !d.upperAge)) {
      assert.equal(evaluate(scheduled.id, month(240), prerequisite(scheduled.id)).status, 'OVERDUE');
    }
  });
});

describe('combined authoritative history', () => {
  it('either supported source counts as administered', () => {
    assert.equal(evaluate('OPV1', day(70), [fhir('OPV1', day(42))]).status, 'ADMINISTERED');
    assert.equal(evaluate('OPV1', day(70), [], [national('OPV1', day(42))]).status, 'ADMINISTERED');
    assert.equal(evaluate('OPV2', day(70), [], [national('OPV1', day(42))]).status, 'DUE');
  });
  it('parallel records count once for prerequisite sequencing and retain provenance', () => {
    const history = normalized([fhir('OPV1', day(42))], [national('OPV1', day(42))]);
    assert.equal(history.doses.length, 1);
    assert.equal(history.doses[0].records.length, 2);
    assert.deepEqual(duplicateRecordIds(history, 'OPV1'), ['fhir:OPV1', 'national-form:OPV1']);
    assert.equal(evaluate('OPV2', day(70), [fhir('OPV1', day(42))], [national('OPV1', day(42))]).status, 'DUE');
  });
  it('excludes only the edited source record, preserving a parallel duplicate', () => {
    const edited = {
      patientUuid, fhir: [fhir('OPV1', day(42))], encounters: [], editingRecordId: 'fhir:OPV1',
      nationalFormUuids: configured.nationalFormUuids, vaccineQuestionUuid: configured.vaccineQuestionUuid,
      vaccineConceptUuids: configured.vaccineConceptUuids,
    };
    assert.deepEqual(duplicateRecordIds(normalizeHistory(edited), 'OPV1'), []);
    assert.deepEqual(duplicateRecordIds(normalizeHistory({ ...edited, encounters: [national('OPV1', day(42))] }), 'OPV1'), ['national-form:OPV1']);
  });
  it('malformed, unmapped, wrong-patient and conflicting-date records fail closed', () => {
    const valid = fhir('OPV1', day(42));
    for (const bad of [ { ...valid, occurrenceDateTime: '2024-02-30' }, { ...valid, id: undefined },
      { ...valid, vaccineCode: { coding: [{ code: 'unknown' }] } }, { ...valid, patient: { reference: 'Patient/other' } },
      { ...valid, protocolApplied: [{ doseNumberPositiveInt: 0 }] }, { ...valid, status: 'unknown' } ]) {
      assert.equal(evaluate('OPV1', day(70), [bad]).status, 'HISTORY_UNRESOLVED');
      assert.equal(evaluate('OPV1', day(70), [bad]).canAdminister, false);
    }
    assert.equal(evaluate('OPV2', day(100), [valid], [national('OPV1', day(56))]).status, 'HISTORY_UNRESOLVED');
    const badNational = national('OPV1', day(42));
    badNational.obs[0].value = 'unmapped';
    assert.equal(evaluate('OPV1', day(70), [], [badNational]).status, 'HISTORY_UNRESOLVED');
  });
  it('does not count voided, not-done, entered-in-error or AEFI history', () => {
    const valid = fhir('OPV1', day(42));
    const encounter = national('OPV1', day(42));
    for (const status of ['not-done', 'entered-in-error']) assert.equal(evaluate('OPV1', day(70), [{ ...valid, status }]).status, 'OVERDUE');
    for (const legacy of [{ ...encounter, voided: true }, { ...encounter, form: { uuid: 'aefi' } },
      { ...encounter, obs: [{ ...encounter.obs[0], voided: true }] }]) {
      assert.equal(evaluate('OPV1', day(70), [], [legacy]).status, 'OVERDUE');
    }
  });
  it('maps generic FHIR vaccine + dose only with explicit metadata and never guesses OPV0', () => {
    const record = { ...fhir('OPV1', day(42)), vaccineCode: { coding: [{ code: 'generic-opv' }] }, protocolApplied: [{ doseNumberPositiveInt: 1 }] };
    assert.equal(normalized([record]).issues.length, 1);
    const mapped = normalizeHistory({
      patientUuid, fhir: [record], encounters: [],
      nationalFormUuids: configured.nationalFormUuids, vaccineQuestionUuid: configured.vaccineQuestionUuid,
      vaccineConceptUuids: configured.vaccineConceptUuids,
      mappings: [{ code: 'generic-opv', system: '', sequenceNumber: 1, canonicalDoseId: 'OPV1' }],
    });
    assert.equal(mapped.issues.length, 0);
    assert.equal(mapped.doses[0].canonicalDoseId, 'OPV1');
    const conflicting = { ...record, protocolApplied: [{ doseNumberPositiveInt: 1 }, { doseNumberPositiveInt: 2 }] };
    assert.equal(normalized([conflicting]).issues.length, 1);
  });
  it('preserves administered state outside windows and across backdated evaluations', () => {
    assert.equal(evaluate('BCG', month(11), [fhir('BCG', birthDate)]).status, 'ADMINISTERED');
    assert.equal(evaluate('OPV0', day(8), [fhir('OPV0', day(7))]).status, 'ADMINISTERED');
    assert.equal(evaluate('OPV1', day(42), [fhir('OPV1', day(56))]).status, 'ADMINISTERED');
  });
  it('rejects incomplete or pre-birth dates rather than granting availability', () => {
    assert.equal(evaluateRoutineSchedule('2024-01', day(42), normalized(), configured.vaccineConceptUuids)[0].canAdminister, false);
    assert.equal(evaluate('OPV1', day(70), [fhir('BCG', '2023-01-01')]).status, 'HISTORY_UNRESOLVED');
    assert.equal(evaluate('OPV1', '2023-01-01').status, 'HISTORY_UNRESOLVED');
  });
});

describe('Liberia date semantics and dashboard integration', () => {
  it('preserves date-only DOB and converts timestamp instants into Liberia dates', () => {
    assert.equal(clinicalDate('2024-01-31'), '2024-01-31');
    assert.equal(clinicalDate('2024-02-01T01:00:00+03:00'), '2024-01-31');
    assert.equal(clinicalDate('2024-01-31T23:00:00-03:00'), '2024-02-01');
    assert.throws(() => clinicalDate('2024-02-01T01:00:00'));
    assert.throws(() => clinicalDate('2024-02-30T01:00:00Z'));
  });
  it('registers alongside O3 history in the existing Immunizations dashboard', () => {
    const extension = routes.extensions.find((e) => e.name === 'liberia-routine-immunization-schedule')!;
    assert.equal(extension.slot, 'patient-chart-immunizations-dashboard-slot');
    assert.equal(extension.component, 'routineImmunizationSchedule');
    assert.equal(extension.offline, false);
  });
});

describe('history completeness', () => {
  it('loads all pages from both sources', async () => {
    const first = fhir('OPV1', day(42));
    const second = fhir('Penta1', day(42));
    const pages = {
      '/fhir/Immunization?patient=patient': { resourceType: 'Bundle', type: 'searchset', total: 2, entry: [{ resource: first }], link: [{ relation: 'next', url: '?page=2' }] },
      '/fhir/Immunization?page=2': { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: second }] },
      '/rest/encounter?patient=patient': { results: [], links: [{ rel: 'next', uri: '?page=2' }] },
      '/rest/encounter?page=2': { results: [national('OPV1', day(42))] },
    };
    const history = await loadHistory('/fhir/Immunization?patient=patient', '/rest/encounter?patient=patient', async (url) => pages[url]);
    assert.equal(history.fhir.length, 2);
    assert.equal(history.encounters.length, 1);
    assert.equal(normalizeHistory({
      patientUuid, ...history,
      nationalFormUuids: configured.nationalFormUuids, vaccineQuestionUuid: configured.vaccineQuestionUuid,
      vaccineConceptUuids: configured.vaccineConceptUuids,
    }).doses.length, 2);
  });
  it('rejects a failed source, missing page, malformed response or cyclic pagination', async () => {
    for (const mode of ['failed', 'missing', 'malformed', 'cycle', 'foreign']) {
      await assert.rejects(loadHistory('/fhir', '/rest', async (url) => {
        if (url === '/rest') return { results: [] };
        if (mode === 'failed') throw new Error('Unavailable');
        if (mode === 'malformed') return {};
        return { resourceType: 'Bundle', type: 'searchset', total: mode === 'missing' ? 1 : 0,
          link: mode === 'cycle' ? [{ relation: 'next', url: '/fhir' }]
            : mode === 'foreign' ? [{ relation: 'next', url: 'https://other.example/fhir' }] : [] };
      }));
    }
  });
});

describe('runtime UUID configuration', () => {
  const siteOpv1 = '11111111-1111-4111-8111-111111111111';
  const siteForm = '22222222-2222-4222-8222-222222222222';
  const siteQuestion = '33333333-3333-4333-8333-333333333333';
  const raw = frontendConfig[moduleName].routineImmunizations;

  it('resolves national frontend config to the Liberia variable values', () => {
    const formVariables = [
      'var.form.immunization.v1-0.uuid',
      'var.form.immunization.v1-1.uuid',
      'var.form.immunization.v1-2.uuid',
      'var.form.immunization.v1-3.uuid',
      'var.form.immunization.v1-4.uuid',
      'var.form.immunization.v1-5.uuid',
      'var.form.immunization.v1-6.uuid',
      'var.form.immunization.v1-7.uuid',
      'var.form.immunization.v1-8.uuid',
      'var.form.immunization.v1-9.uuid',
      'var.form.immunization.v1-10.uuid',
      'var.form.immunization.v1-11.uuid',
      'var.form.immunization.v1-12.uuid',
      'var.form.immunization.v1-13.uuid',
      'var.form.immunization.uuid',
    ];
    assert.deepEqual(raw.nationalFormUuids, formVariables.map((name) => `\${${name}}`));
    assert.deepEqual(configured.nationalFormUuids, formVariables.map((name) => properties.get(name)));
    assert.equal(new Set(configured.nationalFormUuids).size, formVariables.length);
    for (const historical of formVariables.slice(0, -1)) {
      assert.notEqual(properties.get(historical), currentFormUuid, historical);
    }
    assert.equal(configured.nationalFormUuids.at(-1), currentFormUuid);
    assert.equal(raw.vaccineQuestionUuid, '${var.concept.national.vaccine-name.uuid}');
    assert.equal(configured.vaccineQuestionUuid, properties.get('var.concept.national.vaccine-name.uuid'));
    assert.equal(uuidLiteral.test(JSON.stringify(raw)), false);
    for (const [id, variable] of Object.entries(vaccineVariables)) {
      assert.equal(raw.vaccineConceptUuids[id], `\${${variable}}`);
    }
  });
  it('keeps UUID literals out of the schedule, history module and config schema', () => {
    const scheduleJson = readFileSync(new URL('./routine-schedule.json', import.meta.url), 'utf8');
    const historySource = readFileSync(new URL('./history.ts', import.meta.url), 'utf8');
    const configSource = readFileSync(new URL('./routine-config.ts', import.meta.url), 'utf8');
    assert.equal(uuidLiteral.test(scheduleJson), false);
    assert.equal(scheduleJson.includes('vaccineConceptUuid'), false);
    assert.equal(scheduleJson.includes('canonicalDoseId'), true);
    assert.equal(uuidLiteral.test(historySource), false);
    assert.equal(uuidLiteral.test(configSource), false);
    assert.equal(configSource.includes("_default: ''"), true);
    assert.match(configSource, /schedule\.map\(\(dose\) => \[dose\.id/);
  });
  it('matches an overridden vaccine concept and stops matching the previous UUID', () => {
    const vaccineConceptUuids = { ...configured.vaccineConceptUuids, OPV1: siteOpv1 };
    const previous = normalized([fhir('OPV1', day(42))], [], { vaccineConceptUuids });
    assert.equal(previous.doses.length, 0);
    assert.equal(previous.issues.length, 1);
    const local = fhir('OPV1', day(42), 'OPV1', siteOpv1);
    assert.equal(local.vaccineCode?.coding?.[0].system, undefined);
    const matched = normalized([local], [], { vaccineConceptUuids });
    assert.equal(matched.issues.length, 0);
    assert.equal(matched.doses[0].canonicalDoseId, 'OPV1');
    assert.equal(matched.doses[0].vaccineConceptUuid, siteOpv1);
    const row = evaluateRoutineSchedule(birthDate, day(70), matched, vaccineConceptUuids).find((item) => item.dose.id === 'OPV2')!;
    assert.equal(dose('OPV2').prerequisite!.canonicalDoseId, 'OPV1');
    assert.equal(row.dose.prerequisite!.dose.vaccineConceptUuid, siteOpv1);
    assert.equal(row.status, 'DUE');
  });
  it('recognizes Immunization v1.0 through v1.13 and the current form and ignores an unrelated form', () => {
    for (const variable of ['var.form.immunization.v1-0.uuid', 'var.form.immunization.v1-1.uuid', 'var.form.immunization.v1-2.uuid', 'var.form.immunization.v1-3.uuid', 'var.form.immunization.v1-4.uuid', 'var.form.immunization.v1-5.uuid', 'var.form.immunization.v1-6.uuid', 'var.form.immunization.v1-7.uuid', 'var.form.immunization.v1-8.uuid', 'var.form.immunization.v1-9.uuid', 'var.form.immunization.v1-10.uuid', 'var.form.immunization.v1-11.uuid', 'var.form.immunization.v1-12.uuid', 'var.form.immunization.v1-13.uuid', 'var.form.immunization.uuid']) {
      const history = normalized([], [national('OPV1', day(42), configured.vaccineConceptUuids.OPV1, properties.get(variable))]);
      assert.equal(history.issues.length, 0, variable);
      assert.equal(history.doses[0].canonicalDoseId, 'OPV1');
    }
    const unrelated = normalized([], [{ ...national('OPV1', day(42)), form: { uuid: '44444444-4444-4444-8444-444444444444' } }]);
    assert.equal(unrelated.doses.length, 0);
    assert.equal(unrelated.issues.length, 0);
  });
  it('replaces nationalFormUuids wholesale, so an old default stops matching', () => {
    const v12 = properties.get('var.form.immunization.v1-2.uuid')!;
    const kept = normalized([], [national('OPV1', day(42), configured.vaccineConceptUuids.OPV1, v12)]);
    assert.equal(kept.doses[0].canonicalDoseId, 'OPV1');
    const replaced = [siteForm];
    const dropped = normalized([], [national('OPV1', day(42), configured.vaccineConceptUuids.OPV1, v12)], { nationalFormUuids: replaced });
    assert.equal(dropped.doses.length, 0);
    assert.equal(dropped.issues.length, 0);
    const honored = normalized([], [national('OPV1', day(42), configured.vaccineConceptUuids.OPV1, siteForm)], { nationalFormUuids: replaced });
    assert.equal(honored.issues.length, 0);
    assert.equal(honored.doses[0].canonicalDoseId, 'OPV1');
    const mergeSource = readFileSync(new URL('../../node_modules/@openmrs/esm-config/dist/module-config/module-config.js', import.meta.url), 'utf8');
    const merge = mergeSource.slice(mergeSource.indexOf('function mergeDeepReplace'), mergeSource.indexOf('Store setup'));
    assert.match(merge, /if \(Array\.isArray\(srcValue\)\) \{\s*return srcValue;/);
  });
  it('honors a vaccine question UUID override', () => {
    const encounter = national('OPV1', day(42));
    const missed = normalized([], [encounter], { vaccineQuestionUuid: siteQuestion });
    assert.equal(missed.doses.length, 0);
    assert.equal(missed.issues.length, 0);
    const honored = normalized([], [{
      ...encounter,
      obs: [{ ...encounter.obs[0], concept: { uuid: siteQuestion } }],
    }], { vaccineQuestionUuid: siteQuestion });
    assert.equal(honored.issues.length, 0);
    assert.equal(honored.doses[0].canonicalDoseId, 'OPV1');
  });
  it('keeps generic fhirDoseMappings beside the configured local concept map', () => {
    const record: FhirImmunization = {
      ...fhir('OPV1', day(42)),
      vaccineCode: { coding: [{ code: 'generic-opv', system: 'http://example.org/vax' }] },
      protocolApplied: [{ doseNumberPositiveInt: 2 }],
    };
    assert.equal(normalized([record]).doses.length, 0);
    const mapped = normalized([record], [], { mappings: [
      { code: 'generic-opv', system: 'http://example.org/vax', sequenceNumber: 2, canonicalDoseId: 'OPV2' },
    ] });
    assert.equal(mapped.issues.length, 0);
    assert.equal(mapped.doses[0].canonicalDoseId, 'OPV2');
    assert.equal(mapped.doses[0].vaccineConceptUuid, configured.vaccineConceptUuids.OPV2);
  });
});
