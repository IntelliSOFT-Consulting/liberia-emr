import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { addDateOffset } from './eligibility.ts';
import { evaluateRoutineSchedule, routineSchedule } from './routine-schedule.ts';
import { normalizeHistory, nationalFormUuid, vaccineQuestionUuid, duplicateRecordIds,
  type FhirImmunization, type NationalEncounter } from './history.ts';
import { clinicalDate } from './clinical-date.ts';
import { loadHistory } from './load-history.ts';
import routes from '../routes.json' with { type: 'json' };

const birthDate = '2024-01-31';
const patientUuid = 'patient';
const day = (days: number) => addDateOffset(birthDate, { value: days, unit: 'days' });
const month = (months: number) => addDateOffset(birthDate, { value: months, unit: 'months' });
const dose = (id: string) => routineSchedule.find((d) => d.id === id)!;
function fhir(id: string, date: string, recordId = id): FhirImmunization {
  return { resourceType: 'Immunization', id: recordId, status: 'completed', patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: dose(id).vaccineConceptUuid }] }, occurrenceDateTime: date };
}
function national(id: string, date: string): NationalEncounter {
  return { uuid: 'encounter', patient: { uuid: patientUuid }, form: { uuid: nationalFormUuid }, encounterDatetime: date,
    obs: [{ uuid: id, concept: { uuid: vaccineQuestionUuid }, value: { uuid: dose(id).vaccineConceptUuid } }] };
}
function normalized(records: FhirImmunization[] = [], encounters: NationalEncounter[] = []) {
  return normalizeHistory({ patientUuid, fhir: records, encounters });
}
function evaluate(id: string, date: string, records: FhirImmunization[] = [], encounters: NationalEncounter[] = []) {
  return evaluateRoutineSchedule(birthDate, date, normalized(records, encounters)).find((r) => r.dose.id === id)!;
}
function prerequisite(id: string): FhirImmunization[] {
  const prior = dose(id).prerequisite;
  if (!prior) return [];
  const previous = routineSchedule.find((d) => d.vaccineConceptUuid === prior.dose.vaccineConceptUuid)!;
  return [fhir(previous.id, addDateOffset(birthDate, previous.dueAge))];
}

describe('LE-559 DOB schedule', () => {
  it('uses distinct released national dose concepts', () => {
    const properties = readFileSync(new URL('../../../../content-packages/content-liberia-national/configuration/variables.properties', import.meta.url), 'utf8');
    assert.equal(routineSchedule.length, 21);
    assert.equal(new Set(routineSchedule.map((d) => d.id)).size, 21);
    assert.equal(new Set(routineSchedule.map((d) => d.vaccineConceptUuid)).size, 21);
    for (const rule of routineSchedule) assert.ok(properties.includes(`=${rule.vaccineConceptUuid}\n`));
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
      const previous = routineSchedule.find((d) => d.vaccineConceptUuid === scheduled.prerequisite!.dose.vaccineConceptUuid)!;
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
      const rows = evaluateRoutineSchedule(birthDate, month(months), normalized());
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
    const predecessor = (id: string) => routineSchedule.find((prior) =>
      prior.vaccineConceptUuid === dose(id).prerequisite!.dose.vaccineConceptUuid)!.id;
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
    const edited = { patientUuid, fhir: [fhir('OPV1', day(42))], encounters: [], editingRecordId: 'fhir:OPV1' };
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
    const mapped = normalizeHistory({ patientUuid, fhir: [record], encounters: [], mappings: [
      { code: 'generic-opv', system: '', sequenceNumber: 1, canonicalDoseId: 'OPV1' },
    ] });
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
    assert.equal(evaluateRoutineSchedule('2024-01', day(42), normalized())[0].canAdminister, false);
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
    assert.equal(normalizeHistory({ patientUuid, ...history }).doses.length, 2);
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
