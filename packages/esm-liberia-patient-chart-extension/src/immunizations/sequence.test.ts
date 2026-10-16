import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDateOffset, type AdministeredDose } from './eligibility.ts';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import { evaluateDoseRule, evaluateSequence, type SequenceResult } from './sequence.ts';
import {
  ancFormUuid, ignoredConceptUuids, immunizationFormUuid, returnDateConceptUuid, ruleById, vaccineQuestionUuid,
} from './sequence-rules.ts';

const patientUuid = 'patient-1';
const properties = readFileSync(new URL(
  '../../../../content-packages/content-liberia-national/configuration/variables.properties',
  import.meta.url,
), 'utf8');

function variable(key: string): string {
  const line = properties.split('\n').find((item) => item.startsWith(`${key}=`));
  assert.ok(line, key);
  return line!.slice(key.length + 1).trim();
}

function dose(id: string) {
  const rule = ruleById(id);
  assert.ok(rule, id);
  return rule;
}

function fhir(concept: string, date: string, id: string, sequence?: number): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: concept }] },
    occurrenceDateTime: date,
    ...(sequence === undefined ? {} : { protocolApplied: [{ doseNumberPositiveInt: sequence }] }),
  };
}

function vaccineEncounter(concept: string, date: string, obsId: string, extra: NationalEncounter['obs'] = []): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid }, form: { uuid: immunizationFormUuid },
    encounterDatetime: date,
    obs: [{ uuid: obsId, concept: { uuid: vaccineQuestionUuid }, value: { uuid: concept } }, ...extra],
  };
}

function ttEncounter(concept: string, date: string, obsId: string, encounterDatetime = '2020-01-01T00:00:00.000+0000'): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid }, form: { uuid: ancFormUuid },
    encounterDatetime,
    obs: [{ uuid: obsId, concept: { uuid: concept }, value: date }],
  };
}

function decide(
  doseId: string, birthDate: string, evaluationDate: string,
  records: FhirImmunization[] = [], encounters: NationalEncounter[] = [],
): SequenceResult {
  return evaluateSequence({ patientUuid, doseId, birthDate, evaluationDate, fhir: records, encounters });
}

function blocked(result: SequenceResult, status: SequenceResult['status']) {
  assert.equal(result.status, status);
  assert.equal(result.canAdminister, false);
}

function allowed(result: SequenceResult) {
  assert.equal(result.canAdminister, true);
  assert.ok(result.status === 'DUE' || result.status === 'OVERDUE');
}

describe('repository identifiers', () => {
  const keys: Record<string, { canonical: string; equivalents?: string[] }> = {
    OPV1: { canonical: 'var.concept.national.opv1.uuid' },
    OPV2: { canonical: 'var.concept.national.opv2.uuid' },
    OPV3: { canonical: 'var.concept.national.opv3.uuid' },
    Penta1: { canonical: 'var.concept.national.penta-1.uuid' },
    Penta2: { canonical: 'var.concept.national.penta-2.uuid' },
    Penta3: { canonical: 'var.concept.national.penta-3.uuid' },
    Pneumo1: { canonical: 'var.concept.national.pneumo-1.uuid' },
    Pneumo2: { canonical: 'var.concept.national.pneumo-2.uuid' },
    Pneumo3: { canonical: 'var.concept.national.pneumo-3.uuid' },
    Rota1: { canonical: 'var.concept.national.rota-1.uuid' },
    Rota2: { canonical: 'var.concept.national.rota-2.uuid' },
    Malaria1: { canonical: 'var.concept.national.malaria-vaccine-dose-1.uuid' },
    Malaria2: { canonical: 'var.concept.national.malaria-vaccine-dose-2.uuid' },
    Malaria3: { canonical: 'var.concept.national.malaria-vaccine-dose-3.uuid' },
    Malaria4: { canonical: 'var.concept.national.malaria-vaccine-dose-4.uuid' },
    HPV1: { canonical: 'var.concept.national.hpv1.uuid' },
    HPV2: { canonical: 'var.concept.national.hpv2.uuid' },
    PediatricPfizer1: { canonical: 'var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid' },
    PediatricPfizer2: { canonical: 'var.concept.national.pediatric-pfizer-covid-19-dose-2.uuid' },
    TD1: { canonical: 'var.concept.national.td.uuid', equivalents: ['var.concept.national.date-of-tt1.uuid'] },
    TD2: { canonical: 'var.concept.national.td2.uuid', equivalents: ['var.concept.national.date-of-tt2.uuid'] },
    TD3: { canonical: 'var.concept.national.td3.uuid', equivalents: ['var.concept.national.date-of-tt3.uuid'] },
    TD4: { canonical: 'var.concept.national.td4.uuid', equivalents: ['var.concept.national.date-of-tt4.uuid'] },
    TD5: { canonical: 'var.concept.national.td5.uuid', equivalents: ['var.concept.national.date-of-tt5.uuid'] },
  };
  for (const [id, mapping] of Object.entries(keys)) {
    it(`${id} uses ${mapping.canonical}`, () => {
      const rule = dose(id);
      assert.equal(rule.vaccineConceptUuid, variable(mapping.canonical));
      assert.deepEqual([...rule.conceptUuids].sort(), [mapping.canonical, ...(mapping.equivalents ?? [])].map(variable).sort());
    });
  }
  it('uses the unsuffixed TD concept as TD1 and does not invent td1', () => {
    assert.equal(properties.includes('var.concept.national.td1.uuid='), false);
    assert.equal(dose('TD1').vaccineConceptUuid, variable('var.concept.national.td.uuid'));
    assert.equal(ignoredConceptUuids.has(variable('var.concept.national.td.uuid')), false);
    assert.equal(immunizationFormUuid, variable('var.form.immunization.uuid'));
    assert.equal(ancFormUuid, variable('var.form.anc-national.uuid'));
    assert.equal(vaccineQuestionUuid, variable('var.concept.national.vaccine-name.uuid'));
    assert.equal(returnDateConceptUuid, variable('var.concept.national.return-date-for-the-next-vaccination.uuid'));
    for (const [key, uuid] of [
      ['var.concept.national.bcg.uuid', 'fed0b18d-c769-4c9f-9edc-ed7190a1f460'],
      ['var.concept.national.mcv1.uuid', '9e6d911e-2c2a-48da-9002-638ac331a0e8'],
      ['var.concept.national.mcv2.uuid', '51be3ea7-5481-43bf-89fe-d45a25224838'],
    ] as const) {
      assert.equal(variable(key), uuid);
      assert.equal(ignoredConceptUuids.has(uuid), true);
    }
    assert.equal(ruleById('MCV2'), undefined);
  });
});

describe('OPV', () => {
  const birth = '2024-01-01';
  const opv1 = () => fhir(dose('OPV1').vaccineConceptUuid, '2024-02-01', 'opv1');
  it('blocks OPV2 when OPV1 is absent', () => {
    blocked(decide('OPV2', birth, '2024-03-01'), 'WAITING_FOR_PREREQUISITE');
    assert.equal(dose('OPV1').prerequisiteId, undefined);
  });
  it('blocks the day before 28 days and allows day 28', () => {
    blocked(decide('OPV2', birth, '2024-02-28', [opv1()]), 'WAITING_FOR_INTERVAL');
    const valid = decide('OPV2', birth, '2024-02-29', [opv1()]);
    allowed(valid);
    assert.equal(valid.intervalDate, '2024-02-29');
    assert.equal(valid.eligibleDate, '2024-02-29');
    assert.deepEqual(dose('OPV2').minimumInterval, { value: 28, unit: 'days' });
  });
  it('uses the later of scheduled age and the 28-day interval', () => {
    const aged = { ...dose('OPV2'), dueAge: { value: 100, unit: 'days' as const } };
    const early: AdministeredDose = {
      id: 'opv1', vaccineConceptUuid: dose('OPV1').vaccineConceptUuid, sequenceNumber: 1, administeredDate: '2024-01-01',
    };
    const beforeAge = evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-01-29', rule: aged, history: [early] });
    blocked(beforeAge, 'NOT_YET_DUE');
    assert.equal(beforeAge.eligibleDate, '2024-04-10');
    allowed(evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-10', rule: aged, history: [early] }));
    const late: AdministeredDose = { ...early, administeredDate: '2024-04-01' };
    const beforeInterval = evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-10', rule: aged, history: [late] });
    blocked(beforeInterval, 'WAITING_FOR_INTERVAL');
    assert.equal(beforeInterval.eligibleDate, '2024-04-29');
    allowed(evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-29', rule: aged, history: [late] }));
    assert.deepEqual(dose('OPV2').dueAge, { value: 0, unit: 'days' });
  });
  it('blocks OPV3 without OPV2 and does not invent an interval', () => {
    blocked(decide('OPV3', birth, '2024-05-01', [opv1()]), 'WAITING_FOR_PREREQUISITE');
    const sameDay = decide('OPV3', birth, '2024-05-01', [fhir(dose('OPV2').vaccineConceptUuid, '2024-05-01', 'opv2')]);
    allowed(sameDay);
    assert.equal(sameDay.status, 'DUE');
    assert.equal(dose('OPV3').minimumInterval, undefined);
    assert.notEqual(sameDay.status, 'WAITING_FOR_INTERVAL');
  });
});

describe('Penta, Pneumo and Rota', () => {
  const birth = '2024-01-01';
  for (const [later, earlier] of [['Penta2', 'Penta1'], ['Penta3', 'Penta2'], ['Pneumo2', 'Pneumo1'], ['Pneumo3', 'Pneumo2'], ['Rota2', 'Rota1']] as const) {
    it(`${later} requires ${earlier} and adds no interval or maximum age`, () => {
      blocked(decide(later, birth, '2024-06-01'), 'WAITING_FOR_PREREQUISITE');
      const given = fhir(dose(earlier).vaccineConceptUuid, '2024-06-01', earlier);
      const result = decide(later, birth, '2024-06-01', [given]);
      allowed(result);
      assert.equal(result.status, 'DUE');
      assert.equal(dose(later).minimumInterval, undefined);
      assert.equal(dose(later).upperAge, undefined);
      assert.equal(dose(earlier).upperAge, undefined);
    });
  }
  it('does not create a Rota3 rule or a Rota maximum age', () => {
    assert.equal(ruleById('Rota3'), undefined);
    assert.equal(decide('Rota2', '2020-01-01', '2035-01-01', [fhir(dose('Rota1').vaccineConceptUuid, '2020-06-01', 'rota1')]).status, 'DUE');
  });
});

describe('Malaria', () => {
  const birth = '2024-01-01';
  for (const [later, earlier] of [['Malaria2', 'Malaria1'], ['Malaria3', 'Malaria2'], ['Malaria4', 'Malaria3']] as const) {
    it(`${later} requires ${earlier} with no invented interval`, () => {
      blocked(decide(later, birth, '2024-08-01'), 'WAITING_FOR_PREREQUISITE');
      const result = decide(later, birth, '2024-08-01', [fhir(dose(earlier).vaccineConceptUuid, '2024-08-01', earlier)]);
      allowed(result);
      assert.equal(dose(later).minimumInterval, undefined);
      assert.equal(dose(later).upperAge, undefined);
    });
  }
  it('accepts a predecessor from FHIR or the national form', () => {
    const concept = dose('Malaria1').vaccineConceptUuid;
    allowed(decide('Malaria2', birth, '2024-08-01', [fhir(concept, '2024-07-01', 'malaria-fhir')]));
    allowed(decide('Malaria2', birth, '2024-08-01', [], [vaccineEncounter(concept, '2024-07-01', 'malaria-form')]));
  });
});

describe('HPV', () => {
  const birth = '2010-06-15';
  it('applies the inclusive 9 through 13 age window', () => {
    blocked(decide('HPV1', birth, '2018-06-15'), 'NOT_YET_DUE');
    allowed(decide('HPV1', birth, '2019-06-15'));
    allowed(decide('HPV1', birth, '2023-06-15'));
    blocked(decide('HPV1', birth, '2024-06-15'), 'NOT_ELIGIBLE');
    assert.deepEqual(dose('HPV1').dueAge, { value: 9, unit: 'years' });
    assert.deepEqual(dose('HPV1').upperAge, { age: { value: 14, unit: 'years' }, inclusive: false });
  });
  it('clamps a 29 February birth to the anniversary', () => {
    blocked(decide('HPV1', '2016-02-29', '2025-02-27'), 'NOT_YET_DUE');
    allowed(decide('HPV1', '2016-02-29', '2025-02-28'));
    blocked(decide('HPV1', '2016-02-29', '2030-02-28'), 'NOT_ELIGIBLE');
  });
  it('requires HPV1 and the 6 calendar month boundary', () => {
    const first = fhir(dose('HPV1').vaccineConceptUuid, '2024-08-31', 'hpv1');
    blocked(decide('HPV2', '2015-01-01', '2025-02-28'), 'WAITING_FOR_PREREQUISITE');
    blocked(decide('HPV2', '2015-01-01', '2025-02-27', [first]), 'WAITING_FOR_INTERVAL');
    const valid = decide('HPV2', '2015-01-01', '2025-02-28', [first]);
    allowed(valid);
    assert.equal(valid.eligibleDate, '2025-02-28');
    assert.notEqual(addDateOffset('2024-08-31', { value: 6, unit: 'months' }), addDateOffset('2024-08-31', { value: 182, unit: 'days' }));
  });
  it('uses the later of the 9th birthday and the 6 month interval', () => {
    const early = fhir(dose('HPV1').vaccineConceptUuid, '2015-01-01', 'early');
    const tooYoung = decide('HPV2', '2015-01-01', '2015-07-01', [early]);
    blocked(tooYoung, 'NOT_YET_DUE');
    assert.equal(tooYoung.eligibleDate, '2024-01-01');
    const late = fhir(dose('HPV1').vaccineConceptUuid, '2024-03-31', 'late');
    const waiting = decide('HPV2', '2015-01-01', '2024-09-29', [late]);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    assert.equal(waiting.eligibleDate, '2024-09-30');
    allowed(decide('HPV2', '2015-01-01', '2024-09-30', [late]));
  });
});

describe('Pediatric Pfizer', () => {
  const birth = '2019-06-15';
  it('applies the inclusive 5 through 11 age window', () => {
    blocked(decide('PediatricPfizer1', birth, '2023-06-15'), 'NOT_YET_DUE');
    allowed(decide('PediatricPfizer1', birth, '2024-06-15'));
    allowed(decide('PediatricPfizer1', birth, '2030-06-15'));
    blocked(decide('PediatricPfizer1', birth, '2031-06-15'), 'NOT_ELIGIBLE');
    assert.deepEqual(dose('PediatricPfizer2').upperAge, { age: { value: 12, unit: 'years' }, inclusive: false });
  });
  it('requires dose 1 and the 28 day boundary', () => {
    const first = fhir(dose('PediatricPfizer1').vaccineConceptUuid, '2024-01-31', 'pfizer1');
    blocked(decide('PediatricPfizer2', '2014-01-01', '2024-02-28'), 'WAITING_FOR_PREREQUISITE');
    blocked(decide('PediatricPfizer2', '2014-01-01', '2024-02-27', [first]), 'WAITING_FOR_INTERVAL');
    const valid = decide('PediatricPfizer2', '2014-01-01', '2024-02-28', [first]);
    allowed(valid);
    assert.equal(valid.eligibleDate, '2024-02-28');
    const early = fhir(dose('PediatricPfizer1').vaccineConceptUuid, '2019-01-01', 'early');
    const tooYoung = decide('PediatricPfizer2', '2019-01-01', '2019-01-29', [early]);
    blocked(tooYoung, 'NOT_YET_DUE');
    assert.equal(tooYoung.eligibleDate, '2024-01-01');
  });
});

describe('TT and TD', () => {
  const birth = '2010-01-01';
  const td1 = dose('TD1').vaccineConceptUuid;
  const tt1 = dose('TD1').conceptUuids.find((uuid) => uuid !== td1)!;
  const tt2 = dose('TD2').conceptUuids.find((uuid) => uuid !== dose('TD2').vaccineConceptUuid)!;
  it('lets TT1 satisfy the TD2 predecessor', () => {
    blocked(decide('TD2', birth, '2024-02-29'), 'WAITING_FOR_PREREQUISITE');
    const waiting = decide('TD2', birth, '2024-02-28', [], [ttEncounter(tt1, '2024-02-01', 'tt1')]);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    allowed(decide('TD2', birth, '2024-02-29', [], [ttEncounter(tt1, '2024-02-01', 'tt1')]));
    assert.deepEqual(dose('TD2').minimumInterval, { value: 4, unit: 'weeks' });
  });
  it('lets TT2 satisfy the TD3 predecessor at exactly 6 calendar months', () => {
    const history = [ttEncounter(tt2, '2023-08-31', 'tt2')];
    blocked(decide('TD3', birth, '2024-02-28', [], history), 'WAITING_FOR_INTERVAL');
    const valid = decide('TD3', birth, '2024-02-29', [], history);
    allowed(valid);
    assert.equal(valid.eligibleDate, '2024-02-29');
    assert.equal(addDateOffset('2023-08-31', { value: 6, unit: 'months' }), '2024-02-29');
  });
  it('keeps mixed TT and TD history on one sequence', () => {
    const td2 = fhir(dose('TD2').vaccineConceptUuid, '2024-02-01', 'td2');
    const tt3 = ttEncounter(dose('TD3').conceptUuids.find((uuid) => uuid !== dose('TD3').vaccineConceptUuid)!, '2024-08-01', 'tt3');
    allowed(decide('TD3', birth, '2024-08-01', [td2], [ttEncounter(tt1, '2024-01-01', 'tt1')]));
    const td4 = decide('TD4', birth, '2025-08-01', [td2], [ttEncounter(tt1, '2024-01-01', 'tt1'), tt3]);
    allowed(td4);
    assert.equal(td4.eligibleDate, '2025-08-01');
    blocked(decide('TD4', birth, '2025-07-31', [td2], [tt3]), 'WAITING_FOR_INTERVAL');
  });
  it('uses one calendar year from TD3 to TD4 and from TD4 to TD5', () => {
    const td3 = fhir(dose('TD3').vaccineConceptUuid, '2023-03-01', 'td3');
    blocked(decide('TD4', birth, '2024-02-29', [td3]), 'WAITING_FOR_INTERVAL');
    const td4 = decide('TD4', birth, '2024-03-01', [td3]);
    allowed(td4);
    assert.equal(td4.eligibleDate, '2024-03-01');
    assert.equal(addDateOffset('2023-03-01', { value: 365, unit: 'days' }), '2024-02-29');
    const recordedTd4 = fhir(dose('TD4').vaccineConceptUuid, '2024-02-29', 'td4');
    blocked(decide('TD5', birth, '2025-02-27', [recordedTd4]), 'WAITING_FOR_INTERVAL');
    const td5 = decide('TD5', birth, '2025-02-28', [recordedTd4]);
    allowed(td5);
    assert.equal(td5.eligibleDate, '2025-02-28');
  });
  it('counts one administration when TT and TD record the same day', () => {
    const sameDay = decide('TD3', birth, '2024-07-15', [
      fhir(dose('TD2').vaccineConceptUuid, '2024-01-15', 'td2'),
    ], [ttEncounter(tt2, '2024-01-15', 'tt2')]);
    allowed(sameDay);
    assert.equal(sameDay.eligibleDate, '2024-07-15');
    blocked(decide('TD3', birth, '2024-07-15', [
      fhir(dose('TD2').vaccineConceptUuid, '2024-01-16', 'td2'),
    ], [ttEncounter(tt2, '2024-01-15', 'tt2')]), 'UNRESOLVED');
  });
  it('lets plain TD satisfy the TD2 predecessor', () => {
    const coded = fhir(td1, '2024-02-01', 'plain-td');
    const waiting = decide('TD2', birth, '2024-02-28', [coded]);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    assert.notEqual(waiting.status, 'UNRESOLVED');
    allowed(decide('TD2', birth, '2024-02-29', [coded]));
    allowed(decide('OPV2', '2024-01-01', '2024-02-29', [coded, fhir(dose('OPV1').vaccineConceptUuid, '2024-02-01', 'opv1')]));
  });
  it('counts one TD1 when plain TD and TT1 share an administration date', () => {
    const sameDay = decide('TD2', birth, '2024-02-29', [
      fhir(td1, '2024-02-01', 'plain-td'),
    ], [ttEncounter(tt1, '2024-02-01', 'tt1')]);
    allowed(sameDay);
    assert.equal(sameDay.eligibleDate, '2024-02-29');
    blocked(decide('TD2', birth, '2024-02-29', [
      fhir(td1, '2024-02-02', 'plain-td'),
    ], [ttEncounter(tt1, '2024-02-01', 'tt1')]), 'UNRESOLVED');
  });
});

describe('consolidated history', () => {
  const birth = '2024-01-01';
  const concept = () => dose('OPV1').vaccineConceptUuid;
  it('counts a FHIR predecessor and a national-form predecessor', () => {
    allowed(decide('OPV2', birth, '2024-02-29', [fhir(concept(), '2024-02-01', 'fhir-opv1')]));
    allowed(decide('OPV2', birth, '2024-02-29', [], [vaccineEncounter(concept(), '2024-02-01', 'form-opv1')]));
  });
  it('counts the same administration from both sources once', () => {
    const result = decide('OPV2', birth, '2024-02-29', [
      fhir(concept(), '2024-02-01', 'fhir-opv1'),
    ], [vaccineEncounter(concept(), '2024-02-01', 'form-opv1')]);
    allowed(result);
    blocked(decide('OPV2', birth, '2024-02-29', [
      fhir(concept(), '2024-02-01', 'fhir-opv1'),
    ], [vaccineEncounter(concept(), '2024-02-02', 'form-opv1')]), 'UNRESOLVED');
  });
  it('uses the Monrovia date and ignores return date and AEFI mentions', () => {
    const encounter = vaccineEncounter(concept(), '2024-02-01T22:30:00-02:00', 'zoned', [{
      uuid: 'return', concept: { uuid: returnDateConceptUuid }, value: '2024-05-01',
    }]);
    blocked(decide('OPV2', birth, '2024-02-29', [], [encounter]), 'WAITING_FOR_INTERVAL');
    allowed(decide('OPV2', birth, '2024-03-01', [], [encounter]));
    const aefi: NationalEncounter = {
      uuid: 'aefi-enc', patient: { uuid: patientUuid }, form: { uuid: variable('var.form.aefi.uuid') },
      encounterDatetime: '2024-02-01',
      obs: [{ uuid: 'aefi-opv', concept: { uuid: variable('var.concept.national.aefi-vaccine.uuid') }, value: { uuid: concept() } }],
    };
    blocked(decide('OPV2', birth, '2024-03-01', [], [aefi]), 'WAITING_FOR_PREREQUISITE');
  });
  it('fails closed on malformed or ambiguous history', () => {
    const missingDate = fhir(concept(), '2024-02-01', 'missing');
    delete missingDate.occurrenceDateTime;
    blocked(decide('OPV2', birth, '2024-03-01', [missingDate]), 'UNRESOLVED');
    const ambiguous: FhirImmunization = {
      ...fhir(concept(), '2024-02-01', 'text-dose'),
      protocolApplied: [{ doseNumberString: '2' }],
    };
    blocked(decide('OPV2', birth, '2024-03-01', [ambiguous]), 'UNRESOLVED');
    const unknown = fhir('not-a-known-vaccine', '2024-02-01', 'unknown');
    blocked(decide('OPV2', birth, '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('HPV1', '2010-01-01', '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('Malaria1', birth, '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('OPV2', birth, '2024-03-01', [
      fhir(concept(), '2024-02-01', 'one'), fhir(concept(), '2024-02-02', 'two'),
    ]), 'UNRESOLVED');
    blocked(decide('OPV2', birth, '2024-03-01', null, []), 'UNRESOLVED');
    const conflict = fhir(dose('OPV2').vaccineConceptUuid, '2024-02-01', 'bad-sequence', 3);
    blocked(decide('OPV3', birth, '2024-02-01', [conflict]), 'UNRESOLVED');
    allowed(decide('Malaria1', birth, '2024-02-01', [conflict]));
    const opv2 = dose('OPV2').vaccineConceptUuid;
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-omitted')]));
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-one', 1)]));
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-clinical', 2)]));
  });
  it('limits a malformed known dose to its own series', () => {
    const missingDate = fhir(concept(), '2024-02-01', 'missing-opv');
    delete missingDate.occurrenceDateTime;
    blocked(decide('OPV2', birth, '2024-03-01', [missingDate]), 'UNRESOLVED');
    allowed(decide('HPV1', '2015-01-01', '2024-03-01', [missingDate]));
    allowed(decide('Malaria1', birth, '2024-03-01', [missingDate]));
    const badHpv = fhir(dose('HPV1').vaccineConceptUuid, 'not-a-date', 'bad-hpv');
    blocked(decide('HPV1', '2010-01-01', '2020-01-01', [badHpv]), 'UNRESOLVED');
    blocked(decide('HPV2', '2010-01-01', '2020-01-01', [badHpv]), 'UNRESOLVED');
    allowed(decide('OPV1', birth, '2024-02-01', [badHpv]));
    allowed(decide('PediatricPfizer1', '2014-01-01', '2024-01-01', [badHpv]));
    const national = vaccineEncounter(concept(), '2024-02-01', 'form-opv');
    delete national.encounterDatetime;
    blocked(decide('OPV2', birth, '2024-03-01', [], [national]), 'UNRESOLVED');
    allowed(decide('HPV1', '2015-01-01', '2024-03-01', [], [national]));
    allowed(decide('Malaria1', birth, '2024-03-01', [], [national]));
    const badNational = vaccineEncounter(dose('HPV1').vaccineConceptUuid, '2024-02-30', 'bad-form-hpv');
    blocked(decide('HPV2', '2010-01-01', '2024-03-01', [], [badNational]), 'UNRESOLVED');
    allowed(decide('OPV1', birth, '2024-02-01', [], [badNational]));
    allowed(decide('PediatricPfizer1', '2014-01-01', '2024-01-01', [], [badNational]));
  });
});

describe('already administered', () => {
  it('does not treat an existing target dose as eligible to repeat', () => {
    const recorded = fhir(dose('OPV2').vaccineConceptUuid, '2024-06-01', 'existing-opv2');
    const result = decide('OPV2', '2024-01-01', '2024-03-01', [
      fhir(dose('OPV1').vaccineConceptUuid, '2024-02-01', 'opv1'), recorded,
    ]);
    blocked(result, 'ADMINISTERED');
    assert.deepEqual(result.matchingRecordIds, ['fhir:existing-opv2']);
    const national = decide('OPV2', '2024-01-01', '2024-03-01', [
      fhir(dose('OPV1').vaccineConceptUuid, '2024-02-01', 'opv1'),
    ], [vaccineEncounter(dose('OPV2').vaccineConceptUuid, '2024-06-01', 'form-opv2')]);
    blocked(national, 'ADMINISTERED');
  });
});
