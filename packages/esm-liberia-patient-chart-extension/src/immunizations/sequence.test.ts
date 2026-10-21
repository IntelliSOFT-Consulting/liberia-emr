import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDateOffset, type AdministeredDose } from './eligibility.ts';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import { evaluateDoseRule, evaluateSequence, type SequenceResult } from './sequence.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import { recognizedDoseIds, ruleById, sequenceRules } from './sequence-rules.ts';

const patientUuid = 'patient-1';
const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const uuidLiteral = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

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

function variable(key: string): string {
  const value = properties.get(key);
  assert.ok(value, key);
  return value;
}

function dose(id: string) {
  const rule = ruleById(id);
  assert.ok(rule, id);
  return rule;
}

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

function fhir(conceptUuid: string, date: string, id: string, sequence?: number): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
    ...(sequence === undefined ? {} : { protocolApplied: [{ doseNumberPositiveInt: sequence }] }),
  };
}

function vaccineEncounter(
  conceptUuid: string, date: string, obsId: string,
  extra: NationalEncounter['obs'] = [], config: SequenceIdentityConfig = national,
): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid },
    form: { uuid: config.nationalFormUuids[config.nationalFormUuids.length - 1] },
    encounterDatetime: date,
    obs: [{ uuid: obsId, concept: { uuid: config.vaccineQuestionUuid }, value: { uuid: conceptUuid } }, ...extra],
  };
}

function ttEncounter(
  conceptUuid: string, date: string, obsId: string,
  encounterDatetime = '2020-01-01T00:00:00.000+0000', config: SequenceIdentityConfig = national,
): NationalEncounter {
  return {
    uuid: `enc-${obsId}`, patient: { uuid: patientUuid }, form: { uuid: config.ancFormUuids[0] },
    encounterDatetime,
    obs: [{ uuid: obsId, concept: { uuid: conceptUuid }, value: date }],
  };
}

function decide(
  doseId: string, birthDate: string, evaluationDate: string,
  records: FhirImmunization[] = [], encounters: NationalEncounter[] = [],
  config: SequenceIdentityConfig = national,
): SequenceResult {
  return evaluateSequence({ patientUuid, doseId, birthDate, evaluationDate, fhir: records, encounters, config });
}

function blocked(result: SequenceResult, status: SequenceResult['status']) {
  assert.equal(result.status, status);
  assert.equal(result.canAdminister, false);
}

function allowed(result: SequenceResult) {
  assert.equal(result.canAdminister, true);
  assert.ok(result.status === 'DUE' || result.status === 'OVERDUE');
}

describe('runtime identifiers', () => {
  const keys: Record<string, { canonical: string; equivalent?: string }> = {
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
    TD1: { canonical: 'var.concept.national.td.uuid', equivalent: 'var.concept.national.date-of-tt1.uuid' },
    TD2: { canonical: 'var.concept.national.td2.uuid', equivalent: 'var.concept.national.date-of-tt2.uuid' },
    TD3: { canonical: 'var.concept.national.td3.uuid', equivalent: 'var.concept.national.date-of-tt3.uuid' },
    TD4: { canonical: 'var.concept.national.td4.uuid', equivalent: 'var.concept.national.date-of-tt4.uuid' },
    TD5: { canonical: 'var.concept.national.td5.uuid', equivalent: 'var.concept.national.date-of-tt5.uuid' },
  };
  const recognized: Record<string, string> = {
    BCG: 'var.concept.national.bcg.uuid',
    OPV0: 'var.concept.national.opv0-1-dose.uuid',
    IPV: 'var.concept.national.ipv.uuid',
    MCV1: 'var.concept.national.mcv1.uuid',
    MCV2: 'var.concept.national.mcv2.uuid',
    TCV: 'var.concept.national.tcv.uuid',
    YellowFever: 'var.concept.national.yellow-fever.uuid',
    Pfizer: 'var.concept.national.pfizer.uuid',
    JJ: 'var.concept.national.j-j.uuid',
    CovidBooster: 'var.concept.national.covid-19-booster.uuid',
  };
  for (const [id, mapping] of Object.entries(keys)) {
    it(`${id} comes from runtime config`, () => {
      assert.equal(concept(id), variable(mapping.canonical));
      assert.equal('vaccineConceptUuid' in dose(id), false);
      if (mapping.equivalent) assert.equal(ttConcept(id), variable(mapping.equivalent));
    });
  }
  it('covers every sequence rule from runtime config', () => {
    assert.deepEqual(sequenceRules.map((item) => item.id).sort(), Object.keys(keys).sort());
  });
  it('loads form and question UUIDs from runtime config', () => {
    const raw = frontendConfig[moduleName].routineImmunizations;
    const formVariables = [
      'var.form.immunization.v1-0.uuid',
      'var.form.immunization.v1-1.uuid',
      'var.form.immunization.v1-2.uuid',
      'var.form.immunization.v1-3.uuid',
      'var.form.immunization.v1-4.uuid',
      'var.form.immunization.v1-5.uuid',
      'var.form.immunization.v1-6.uuid',
      'var.form.immunization.v1-7.uuid',
      'var.form.immunization.uuid',
    ];
    assert.deepEqual(raw.nationalFormUuids, formVariables.map((name) => `\${${name}}`));
    assert.deepEqual([...national.nationalFormUuids], formVariables.map((name) => variable(name)));
    assert.equal(raw.vaccineQuestionUuid, '${var.concept.national.vaccine-name.uuid}');
    assert.equal(national.vaccineQuestionUuid, variable('var.concept.national.vaccine-name.uuid'));
    const ancFormVariables = ['var.form.1-anc-form.v1-1.uuid', 'var.form.anc-national.uuid'];
    assert.deepEqual(raw.ancFormUuids, ancFormVariables.map((name) => `\${${name}}`));
    assert.deepEqual([...national.ancFormUuids], ancFormVariables.map((name) => variable(name)));
    for (const value of JSON.stringify(raw).match(/[0-9a-fA-F-]{36}/g) ?? []) {
      assert.equal(uuidLiteral.test(value), false);
    }
    assert.equal(uuidLiteral.test(JSON.stringify(raw)), false);
  });
  it('uses the unsuffixed TD concept as TD1 and does not invent td1', () => {
    assert.equal(properties.has('var.concept.national.td1.uuid'), false);
    assert.equal(concept('TD1'), variable('var.concept.national.td.uuid'));
    assert.equal(ruleById('MCV2'), undefined);
    assert.deepEqual([...recognizedDoseIds], Object.keys(recognized));
    for (const [id, key] of Object.entries(recognized)) {
      assert.equal(concept(id), variable(key));
      assert.equal(ruleById(id), undefined);
    }
  });
  it('keeps UUID literals out of production sequencing source', () => {
    for (const name of ['sequence-rules.ts', 'sequence.ts', 'history.ts', 'routine-config.ts', 'clinical-date.ts']) {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      assert.equal(uuidLiteral.test(source), false, name);
    }
  });
});

describe('OPV', () => {
  const birth = '2024-01-01';
  const opv1 = () => fhir(concept('OPV1'), '2024-02-01', 'opv1');
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
      id: 'opv1', vaccineConceptUuid: concept('OPV1'), sequenceNumber: 1, administeredDate: '2024-01-01',
    };
    const beforeAge = evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-01-29', rule: aged, history: [early], vaccineConceptUuids: national.vaccineConceptUuids });
    blocked(beforeAge, 'NOT_YET_DUE');
    assert.equal(beforeAge.eligibleDate, '2024-04-10');
    allowed(evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-10', rule: aged, history: [early], vaccineConceptUuids: national.vaccineConceptUuids }));
    const late: AdministeredDose = { ...early, administeredDate: '2024-04-01' };
    const beforeInterval = evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-10', rule: aged, history: [late], vaccineConceptUuids: national.vaccineConceptUuids });
    blocked(beforeInterval, 'WAITING_FOR_INTERVAL');
    assert.equal(beforeInterval.eligibleDate, '2024-04-29');
    allowed(evaluateDoseRule({ birthDate: birth, evaluationDate: '2024-04-29', rule: aged, history: [late], vaccineConceptUuids: national.vaccineConceptUuids }));
    assert.deepEqual(dose('OPV2').dueAge, { value: 0, unit: 'days' });
  });
  it('blocks OPV3 without OPV2 and does not invent an interval', () => {
    blocked(decide('OPV3', birth, '2024-05-01', [opv1()]), 'WAITING_FOR_PREREQUISITE');
    const sameDay = decide('OPV3', birth, '2024-05-01', [fhir(concept('OPV2'), '2024-05-01', 'opv2')]);
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
      const given = fhir(concept(earlier), '2024-06-01', earlier);
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
    assert.equal(decide('Rota2', '2020-01-01', '2035-01-01', [fhir(concept('Rota1'), '2020-06-01', 'rota1')]).status, 'DUE');
  });
});

describe('Malaria', () => {
  const birth = '2024-01-01';
  for (const [later, earlier] of [['Malaria2', 'Malaria1'], ['Malaria3', 'Malaria2'], ['Malaria4', 'Malaria3']] as const) {
    it(`${later} requires ${earlier} with no invented interval`, () => {
      blocked(decide(later, birth, '2024-08-01'), 'WAITING_FOR_PREREQUISITE');
      const result = decide(later, birth, '2024-08-01', [fhir(concept(earlier), '2024-08-01', earlier)]);
      allowed(result);
      assert.equal(dose(later).minimumInterval, undefined);
      assert.equal(dose(later).upperAge, undefined);
    });
  }
  it('accepts a predecessor from FHIR or the national form', () => {
    const malaria1 = concept('Malaria1');
    allowed(decide('Malaria2', birth, '2024-08-01', [fhir(malaria1, '2024-07-01', 'malaria-fhir')]));
    allowed(decide('Malaria2', birth, '2024-08-01', [], [vaccineEncounter(malaria1, '2024-07-01', 'malaria-form')]));
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
    const first = fhir(concept('HPV1'), '2024-08-31', 'hpv1');
    blocked(decide('HPV2', '2015-01-01', '2025-02-28'), 'WAITING_FOR_PREREQUISITE');
    blocked(decide('HPV2', '2015-01-01', '2025-02-27', [first]), 'WAITING_FOR_INTERVAL');
    const valid = decide('HPV2', '2015-01-01', '2025-02-28', [first]);
    allowed(valid);
    assert.equal(valid.eligibleDate, '2025-02-28');
    assert.notEqual(addDateOffset('2024-08-31', { value: 6, unit: 'months' }), addDateOffset('2024-08-31', { value: 182, unit: 'days' }));
  });
  it('uses the later of the 9th birthday and the 6 month interval', () => {
    const early = fhir(concept('HPV1'), '2015-01-01', 'early');
    const tooYoung = decide('HPV2', '2015-01-01', '2015-07-01', [early]);
    blocked(tooYoung, 'NOT_YET_DUE');
    assert.equal(tooYoung.eligibleDate, '2024-01-01');
    const late = fhir(concept('HPV1'), '2024-03-31', 'late');
    const waiting = decide('HPV2', '2015-01-01', '2024-09-29', [late]);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    assert.equal(waiting.eligibleDate, '2024-09-30');
    allowed(decide('HPV2', '2015-01-01', '2024-09-30', [late]));
  });
});

describe('Pediatric Pfizer', () => {
  const birth = '2014-01-01';
  it('allows dose 1 from the 5th birthday through the day before the 12th', () => {
    blocked(decide('PediatricPfizer1', birth, '2018-12-31'), 'NOT_YET_DUE');
    const fifth = decide('PediatricPfizer1', birth, '2019-01-01');
    allowed(fifth);
    assert.equal(fifth.status, 'DUE');
    allowed(decide('PediatricPfizer1', birth, '2025-12-31'));
    blocked(decide('PediatricPfizer1', birth, '2026-01-01'), 'NOT_ELIGIBLE');
    assert.deepEqual(dose('PediatricPfizer1').dueAge, { value: 5, unit: 'years' });
    assert.deepEqual(dose('PediatricPfizer1').upperAge, { age: { value: 12, unit: 'years' }, inclusive: false });
    assert.equal(dose('PediatricPfizer2').upperAge, undefined);
    assert.deepEqual(dose('PediatricPfizer2').dueAge, { value: 0, unit: 'days' });
    assert.equal(dose('PediatricPfizer2').markOverdueAfterEligibleDate, true);
    assert.equal(dose('OPV2').markOverdueAfterEligibleDate, undefined);
  });
  it('requires dose 1, allows day 28, and marks a later day overdue', () => {
    const first = fhir(concept('PediatricPfizer1'), '2025-12-20', 'pfizer1');
    blocked(decide('PediatricPfizer2', birth, '2026-01-17'), 'WAITING_FOR_PREREQUISITE');
    blocked(decide('PediatricPfizer2', birth, '2026-01-16', [first]), 'WAITING_FOR_INTERVAL');
    const due = decide('PediatricPfizer2', birth, '2026-01-17', [first]);
    allowed(due);
    assert.equal(due.status, 'DUE');
    assert.equal(due.eligibleDate, '2026-01-17');
    const overdue = decide('PediatricPfizer2', birth, '2026-01-18', [first]);
    allowed(overdue);
    assert.equal(overdue.status, 'OVERDUE');
    const stillDue = decide('OPV2', '2024-01-01', '2024-06-01', [fhir(concept('OPV1'), '2024-02-01', 'opv1')]);
    assert.equal(stillDue.status, 'DUE');
  });
  it('allows dose 2 after the 12th birthday when dose 1 was given at age 11', () => {
    const first = fhir(concept('PediatricPfizer1'), '2025-12-20', 'pfizer1');
    const result = decide('PediatricPfizer2', birth, '2026-01-17', [first]);
    allowed(result);
    assert.equal(result.status, 'DUE');
    assert.equal(addDateOffset('2014-01-01', { value: 12, unit: 'years' }), '2026-01-01');
    assert.equal(addDateOffset('2025-12-20', { value: 28, unit: 'days' }), '2026-01-17');
  });
});

describe('TT and TD', () => {
  const birth = '2010-01-01';
  const td1 = concept('TD1');
  const tt1 = ttConcept('TD1');
  const tt2 = ttConcept('TD2');
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
    const td2 = fhir(concept('TD2'), '2024-02-01', 'td2');
    const tt3 = ttEncounter(ttConcept('TD3'), '2024-08-01', 'tt3');
    allowed(decide('TD3', birth, '2024-08-01', [td2], [ttEncounter(tt1, '2024-01-01', 'tt1')]));
    const td4 = decide('TD4', birth, '2025-08-01', [td2], [ttEncounter(tt1, '2024-01-01', 'tt1'), tt3]);
    allowed(td4);
    assert.equal(td4.eligibleDate, '2025-08-01');
    blocked(decide('TD4', birth, '2025-07-31', [td2], [tt3]), 'WAITING_FOR_INTERVAL');
  });
  it('uses one calendar year from TD3 to TD4 and from TD4 to TD5', () => {
    const td3 = fhir(concept('TD3'), '2023-03-01', 'td3');
    blocked(decide('TD4', birth, '2024-02-29', [td3]), 'WAITING_FOR_INTERVAL');
    const td4 = decide('TD4', birth, '2024-03-01', [td3]);
    allowed(td4);
    assert.equal(td4.eligibleDate, '2024-03-01');
    assert.equal(addDateOffset('2023-03-01', { value: 365, unit: 'days' }), '2024-02-29');
    const recordedTd4 = fhir(concept('TD4'), '2024-02-29', 'td4');
    blocked(decide('TD5', birth, '2025-02-27', [recordedTd4]), 'WAITING_FOR_INTERVAL');
    const td5 = decide('TD5', birth, '2025-02-28', [recordedTd4]);
    allowed(td5);
    assert.equal(td5.eligibleDate, '2025-02-28');
  });
  it('counts one administration when TT and TD record the same day', () => {
    const sameDay = decide('TD3', birth, '2024-07-15', [
      fhir(concept('TD2'), '2024-01-15', 'td2'),
    ], [ttEncounter(tt2, '2024-01-15', 'tt2')]);
    allowed(sameDay);
    assert.equal(sameDay.eligibleDate, '2024-07-15');
    blocked(decide('TD3', birth, '2024-07-15', [
      fhir(concept('TD2'), '2024-01-16', 'td2'),
    ], [ttEncounter(tt2, '2024-01-15', 'tt2')]), 'UNRESOLVED');
  });
  it('lets plain TD satisfy the TD2 predecessor', () => {
    const coded = fhir(td1, '2024-02-01', 'plain-td');
    const waiting = decide('TD2', birth, '2024-02-28', [coded]);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    assert.notEqual(waiting.status, 'UNRESOLVED');
    allowed(decide('TD2', birth, '2024-02-29', [coded]));
    allowed(decide('OPV2', '2024-01-01', '2024-02-29', [coded, fhir(concept('OPV1'), '2024-02-01', 'opv1')]));
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
  const opv1Concept = () => concept('OPV1');
  it('counts a FHIR predecessor and a national-form predecessor', () => {
    allowed(decide('OPV2', birth, '2024-02-29', [fhir(opv1Concept(), '2024-02-01', 'fhir-opv1')]));
    allowed(decide('OPV2', birth, '2024-02-29', [], [vaccineEncounter(opv1Concept(), '2024-02-01', 'form-opv1')]));
  });
  it('counts the same administration from both sources once', () => {
    const result = decide('OPV2', birth, '2024-02-29', [
      fhir(opv1Concept(), '2024-02-01', 'fhir-opv1'),
    ], [vaccineEncounter(opv1Concept(), '2024-02-01', 'form-opv1')]);
    allowed(result);
    blocked(decide('OPV2', birth, '2024-02-29', [
      fhir(opv1Concept(), '2024-02-01', 'fhir-opv1'),
    ], [vaccineEncounter(opv1Concept(), '2024-02-02', 'form-opv1')]), 'UNRESOLVED');
  });
  it('uses the Monrovia date and ignores return date and AEFI mentions', () => {
    const encounter = vaccineEncounter(opv1Concept(), '2024-02-01T22:30:00-02:00', 'zoned', [{
      uuid: 'return', concept: { uuid: variable('var.concept.national.return-date-for-the-next-vaccination.uuid') }, value: '2024-05-01',
    }]);
    blocked(decide('OPV2', birth, '2024-02-29', [], [encounter]), 'WAITING_FOR_INTERVAL');
    allowed(decide('OPV2', birth, '2024-03-01', [], [encounter]));
    const aefi: NationalEncounter = {
      uuid: 'aefi-enc', patient: { uuid: patientUuid }, form: { uuid: variable('var.form.aefi.uuid') },
      encounterDatetime: '2024-02-01',
      obs: [{ uuid: 'aefi-opv', concept: { uuid: variable('var.concept.national.aefi-vaccine.uuid') }, value: { uuid: opv1Concept() } }],
    };
    blocked(decide('OPV2', birth, '2024-03-01', [], [aefi]), 'WAITING_FOR_PREREQUISITE');
  });
  it('fails closed on malformed or ambiguous history', () => {
    const missingDate = fhir(opv1Concept(), '2024-02-01', 'missing');
    delete missingDate.occurrenceDateTime;
    blocked(decide('OPV2', birth, '2024-03-01', [missingDate]), 'UNRESOLVED');
    const ambiguous: FhirImmunization = {
      ...fhir(opv1Concept(), '2024-02-01', 'text-dose'),
      protocolApplied: [{ doseNumberString: '2' }],
    };
    blocked(decide('OPV2', birth, '2024-03-01', [ambiguous]), 'UNRESOLVED');
    const unknown = fhir('not-a-known-vaccine', '2024-02-01', 'unknown');
    blocked(decide('OPV2', birth, '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('HPV1', '2010-01-01', '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('Malaria1', birth, '2024-03-01', [unknown]), 'UNRESOLVED');
    blocked(decide('OPV2', birth, '2024-03-01', [
      fhir(opv1Concept(), '2024-02-01', 'one'), fhir(opv1Concept(), '2024-02-02', 'two'),
    ]), 'UNRESOLVED');
    blocked(decide('OPV2', birth, '2024-03-01', null, []), 'UNRESOLVED');
    const conflict = fhir(concept('OPV2'), '2024-02-01', 'bad-sequence', 3);
    blocked(decide('OPV3', birth, '2024-02-01', [conflict]), 'UNRESOLVED');
    allowed(decide('Malaria1', birth, '2024-02-01', [conflict]));
    const opv2 = concept('OPV2');
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-omitted')]));
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-one', 1)]));
    allowed(decide('OPV3', birth, '2024-05-01', [fhir(opv2, '2024-05-01', 'seq-clinical', 2)]));
  });
  it('limits a malformed known dose to its own series', () => {
    const missingDate = fhir(opv1Concept(), '2024-02-01', 'missing-opv');
    delete missingDate.occurrenceDateTime;
    blocked(decide('OPV2', birth, '2024-03-01', [missingDate]), 'UNRESOLVED');
    allowed(decide('HPV1', '2015-01-01', '2024-03-01', [missingDate]));
    allowed(decide('Malaria1', birth, '2024-03-01', [missingDate]));
    const badHpv = fhir(concept('HPV1'), 'not-a-date', 'bad-hpv');
    blocked(decide('HPV1', '2010-01-01', '2020-01-01', [badHpv]), 'UNRESOLVED');
    blocked(decide('HPV2', '2010-01-01', '2020-01-01', [badHpv]), 'UNRESOLVED');
    allowed(decide('OPV1', birth, '2024-02-01', [badHpv]));
    allowed(decide('PediatricPfizer1', '2014-01-01', '2024-01-01', [badHpv]));
    const formRecord = vaccineEncounter(opv1Concept(), '2024-02-01', 'form-opv');
    delete formRecord.encounterDatetime;
    blocked(decide('OPV2', birth, '2024-03-01', [], [formRecord]), 'UNRESOLVED');
    allowed(decide('HPV1', '2015-01-01', '2024-03-01', [], [formRecord]));
    allowed(decide('Malaria1', birth, '2024-03-01', [], [formRecord]));
    const badNational = vaccineEncounter(concept('HPV1'), '2024-02-30', 'bad-form-hpv');
    blocked(decide('HPV2', '2010-01-01', '2024-03-01', [], [badNational]), 'UNRESOLVED');
    allowed(decide('OPV1', birth, '2024-02-01', [], [badNational]));
    allowed(decide('PediatricPfizer1', '2014-01-01', '2024-01-01', [], [badNational]));
  });
});

describe('already administered', () => {
  it('does not treat an existing target dose as eligible to repeat', () => {
    const recorded = fhir(concept('OPV2'), '2024-06-01', 'existing-opv2');
    const result = decide('OPV2', '2024-01-01', '2024-03-01', [
      fhir(concept('OPV1'), '2024-02-01', 'opv1'), recorded,
    ]);
    blocked(result, 'ADMINISTERED');
    assert.deepEqual(result.matchingRecordIds, ['fhir:existing-opv2']);
    const recordedOnForm = decide('OPV2', '2024-01-01', '2024-03-01', [
      fhir(concept('OPV1'), '2024-02-01', 'opv1'),
    ], [vaccineEncounter(concept('OPV2'), '2024-06-01', 'form-opv2')]);
    blocked(recordedOnForm, 'ADMINISTERED');
  });
});

describe('runtime overrides', () => {
  const birth = '2024-01-01';
  const siteOpv1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const siteForm = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const siteQuestion = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const siteAncForm = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
  const siteTt1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';

  it('recognizes an overridden OPV1 concept as the OPV2 predecessor', () => {
    const config: SequenceIdentityConfig = {
      ...national,
      vaccineConceptUuids: { ...national.vaccineConceptUuids, OPV1: siteOpv1 },
    };
    const missed = decide('OPV2', birth, '2024-02-29', [fhir(concept('OPV1'), '2024-02-01', 'national-opv1')], [], config);
    blocked(missed, 'UNRESOLVED');
    assert.match(missed.issues.join(' '), /cannot be mapped unambiguously/);
    const waiting = decide('OPV2', birth, '2024-02-28', [fhir(siteOpv1, '2024-02-01', 'site-opv1')], [], config);
    blocked(waiting, 'WAITING_FOR_INTERVAL');
    allowed(decide('OPV2', birth, '2024-02-29', [fhir(siteOpv1, '2024-02-01', 'site-opv1')], [], config));
  });

  it('counts only immunization forms in the runtime list', () => {
    const current = national.nationalFormUuids.at(-1)!;
    const withSite: SequenceIdentityConfig = { ...national, nationalFormUuids: [current, siteForm] };
    const onCurrent = vaccineEncounter(concept('OPV1'), '2024-02-01', 'current-form');
    const onSite = vaccineEncounter(concept('OPV1'), '2024-02-01', 'site-form', [], withSite);
    allowed(decide('OPV2', birth, '2024-02-29', [], [onCurrent], withSite));
    allowed(decide('OPV2', birth, '2024-02-29', [], [onSite], withSite));
    const replaced: SequenceIdentityConfig = { ...national, nationalFormUuids: [siteForm] };
    blocked(decide('OPV2', birth, '2024-02-29', [], [onCurrent], replaced), 'WAITING_FOR_PREREQUISITE');
    allowed(decide('OPV2', birth, '2024-02-29', [], [onSite], replaced));
  });

  it('reads the runtime vaccine question', () => {
    const config: SequenceIdentityConfig = { ...national, vaccineQuestionUuid: siteQuestion };
    blocked(decide('OPV2', birth, '2024-02-29', [], [
      vaccineEncounter(concept('OPV1'), '2024-02-01', 'national-question'),
    ], config), 'WAITING_FOR_PREREQUISITE');
    allowed(decide('OPV2', birth, '2024-02-29', [], [
      vaccineEncounter(concept('OPV1'), '2024-02-01', 'site-question', [], config),
    ], config));
  });

  it('maps ANC TT through runtime config', () => {
    const config: SequenceIdentityConfig = {
      ...national,
      ancFormUuids: [siteAncForm],
      ancTtConceptUuids: { ...national.ancTtConceptUuids, TD1: siteTt1 },
    };
    blocked(decide('TD2', '2010-01-01', '2024-02-29', [], [
      ttEncounter(ttConcept('TD1'), '2024-02-01', 'national-tt'),
    ], config), 'WAITING_FOR_PREREQUISITE');
    const siteTt = ttEncounter(siteTt1, '2024-02-01', 'site-tt', '2020-01-01T00:00:00.000+0000', config);
    blocked(decide('TD2', '2010-01-01', '2024-02-28', [], [siteTt], config), 'WAITING_FOR_INTERVAL');
    allowed(decide('TD2', '2010-01-01', '2024-02-29', [], [siteTt], config));
  });

  it('counts a mapped FHIR coding and does not treat its system code as a concept UUID', () => {
    const generic: FhirImmunization = {
      ...fhir(concept('OPV1'), '2024-02-01', 'generic-opv'),
      vaccineCode: { coding: [{ code: 'generic-opv', system: 'http://example.org/vax' }] },
      protocolApplied: [{ doseNumberPositiveInt: 1 }],
    };
    blocked(decide('OPV2', birth, '2024-02-29', [generic]), 'UNRESOLVED');
    const config: SequenceIdentityConfig = {
      ...national,
      fhirDoseMappings: [{ code: 'generic-opv', system: 'http://example.org/vax', sequenceNumber: 1, canonicalDoseId: 'OPV1' }],
    };
    blocked(decide('OPV2', birth, '2024-02-28', [generic], [], config), 'WAITING_FOR_INTERVAL');
    allowed(decide('OPV2', birth, '2024-02-29', [generic], [], config));
  });

  it('does not let a recognized non-sequence vaccine block another series', () => {
    blocked(decide('OPV2', birth, '2024-03-01', [fhir(concept('BCG'), '2024-02-01', 'bcg')]), 'WAITING_FOR_PREREQUISITE');
    blocked(decide('OPV2', birth, '2024-03-01', [fhir('not-a-known-vaccine', '2024-02-01', 'unknown')]), 'UNRESOLVED');
  });
});
