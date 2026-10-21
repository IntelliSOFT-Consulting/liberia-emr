import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { LabourEpisodeConfig } from '../forms/labour-episode.ts';
import type { FhirImmunization } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import {
  classifyCurrentPregnancy,
  decideTdGate,
  isTdVaccine,
  monroviaCalendarDate,
  tdConceptsFromFormArgs,
  tdIntervalDate,
  type TdConcepts,
  type TdHistoryEncounter,
} from './td-pregnancy.ts';

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const patientUuid = 'patient-1';
const birthDate = '1990-01-01';

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

const episodeConfig: LabourEpisodeConfig = { deliveryEncounterTypeUuid: 'delivery-type' };

const pregnancyStatusConceptUuid = variable('var.concept.ciel.pregnancy-status.uuid');
const trimesters = [
  variable('var.concept.national.1st-trimester.uuid'),
  variable('var.concept.national.2nd-trimester.uuid'),
  variable('var.concept.national.3rd-trimester.uuid'),
];

const concepts: TdConcepts = tdConceptsFromFormArgs(
  pregnancyStatusConceptUuid,
  trimesters[0],
  trimesters[1],
  trimesters[2],
  national.vaccineQuestionUuid,
  national.vaccineConceptUuids.TD1,
  national.ancTtConceptUuids.TD1,
  national.vaccineConceptUuids.TD2,
  national.ancTtConceptUuids.TD2,
  national.vaccineConceptUuids.TD3,
  national.ancTtConceptUuids.TD3,
  national.vaccineConceptUuids.TD4,
  national.ancTtConceptUuids.TD4,
  national.vaccineConceptUuids.TD5,
  national.ancTtConceptUuids.TD5,
);

function td(sequence: 1 | 2 | 3 | 4 | 5) {
  return concepts.doses[sequence - 1].tdConceptUuid;
}

function tt(sequence: 1 | 2 | 3 | 4 | 5) {
  return concepts.doses[sequence - 1].ttConceptUuid;
}

function fhirDose(conceptUuid: string, date: string, id: string): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function tdEncounter(conceptUuid: string, datetime: string, id = `imm-${conceptUuid}-${datetime}`): TdHistoryEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    form: { uuid: national.nationalFormUuids[national.nationalFormUuids.length - 1] },
    encounterDatetime: datetime,
    obs: [{ uuid: `${id}-obs`, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function ttEncounter(
  ttConceptUuid: string, date: string, id = `tt-${ttConceptUuid}-${date}`,
  encounterDatetime = `${date}T09:00:00.000Z`,
): TdHistoryEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
    encounterDatetime,
    obs: [{ uuid: `obs-${id}`, concept: { uuid: ttConceptUuid }, value: date }],
  };
}

function pregnancyEncounter(datetime: string, valueUuid: string, id = `preg-${datetime}`): TdHistoryEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    encounterDatetime: datetime,
    obs: [{ uuid: `${id}-obs`, concept: { uuid: pregnancyStatusConceptUuid }, value: { uuid: valueUuid } }],
  };
}

function deliveryEncounter(datetime: string, id = `delivery-${datetime}`): TdHistoryEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    encounterType: { uuid: 'delivery-type' },
    encounterDatetime: datetime,
    obs: [],
  };
}

function gate(input: {
  vaccine: string;
  evaluationDate: string;
  fhir?: readonly FhirImmunization[];
  encounters?: readonly TdHistoryEncounter[];
  historyComplete?: boolean;
  patientId?: string;
  editingEncounterUuid?: string;
  birth?: string;
  config?: SequenceIdentityConfig;
}) {
  return decideTdGate({
    patientId: input.patientId === undefined ? patientUuid : input.patientId,
    birthDate: input.birth === undefined ? birthDate : input.birth,
    evaluationDate: input.evaluationDate,
    vaccineConceptUuid: input.vaccine,
    editingEncounterUuid: input.editingEncounterUuid,
    concepts,
    fhir: input.fhir ?? [],
    encounters: input.encounters ?? [],
    episodeConfig,
    config: input.config ?? national,
    historyComplete: input.historyComplete ?? true,
  });
}

describe('Td vaccine identity', () => {
  it('recognises only the five canonical Td concepts', () => {
    assert.equal(isTdVaccine('td1', 'td1', 'td2', 'td3', 'td4', 'td5'), true);
    assert.equal(isTdVaccine('td5', 'td1', 'td2', 'td3', 'td4', 'td5'), true);
    assert.equal(isTdVaccine('opv', 'td1', 'td2', 'td3', 'td4', 'td5'), false);
    assert.equal(isTdVaccine('', 'td1'), false);
    assert.equal(isTdVaccine('td1', ''), false);
  });
});

describe('Monrovia administration dates', () => {
  it('keeps a date-only value and converts timestamps in Monrovia', () => {
    assert.equal(monroviaCalendarDate('2024-01-15'), '2024-01-15');
    assert.equal(monroviaCalendarDate('2024-01-15T00:00:00.000+0000'), '2024-01-15');
    assert.equal(monroviaCalendarDate('2024-01-15T00:30:00.000+02:00'), '2024-01-14');
    assert.equal(monroviaCalendarDate('not-a-date'), null);
  });
});

describe('Td pregnancy eligibility', () => {
  const pregnant = [pregnancyEncounter('2024-05-01T08:00:00.000Z', trimesters[1])];

  it('lets a confirmed pregnancy proceed to Td1', () => {
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: pregnant }), 'allowed');
  });

  it('treats each trimester as pregnant', () => {
    for (const value of trimesters) {
      assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: [pregnancyEncounter('2024-05-01T08:00:00.000Z', value)] }), 'allowed');
    }
  });

  it('blocks unknown, missing, and unreadable pregnancy status', () => {
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: [] }), 'unknown-pregnancy');
    for (const value of ['some-other-code', 'ciel-1065', 'ciel-1066']) {
      assert.equal(gate({
        vaccine: td(1),
        evaluationDate: '2024-06-01',
        encounters: [pregnancyEncounter('2024-05-01T08:00:00.000Z', value)],
      }), 'unknown-pregnancy');
    }
  });

  it('does not carry pregnancy across a delivery', () => {
    const encounters = [
      pregnancyEncounter('2024-01-10T08:00:00.000Z', trimesters[2], 'old-pregnancy'),
      deliveryEncounter('2024-03-01T08:00:00.000Z'),
    ];
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters }), 'unknown-pregnancy');
    encounters.push(pregnancyEncounter('2024-04-02T08:00:00.000Z', trimesters[0], 'current-pregnancy'));
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters }), 'allowed');
  });

  it('fails closed when the latest pregnancy-status values disagree', () => {
    const datetime = '2024-05-01T08:00:00.000Z';
    const mixed: TdHistoryEncounter = {
      uuid: 'mixed', patient: { uuid: patientUuid }, encounterDatetime: datetime,
      obs: [
        { uuid: 'mixed-1', concept: { uuid: pregnancyStatusConceptUuid }, value: { uuid: trimesters[0] } },
        { uuid: 'mixed-2', concept: { uuid: pregnancyStatusConceptUuid }, value: { uuid: 'ciel-1066' } },
      ],
    };
    assert.equal(classifyCurrentPregnancy({
      encounters: [mixed],
      config: episodeConfig,
      evaluationTime: Date.parse('2024-06-01T23:59:59.999Z'),
      concepts,
    }), 'unknown');
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: [mixed] }), 'unknown-pregnancy');
  });

  it('does not block an unrelated vaccine', () => {
    const conflict = [
      pregnancyEncounter('2024-05-01T08:00:00.000Z', trimesters[1]),
      ttEncounter(tt(1), '2024-01-01'),
      tdEncounter(td(1), '2024-02-01T10:00:00.000Z'),
    ];
    assert.equal(gate({ vaccine: national.vaccineConceptUuids.OPV1, evaluationDate: '2024-06-01', encounters: conflict, historyComplete: false }), 'allowed');
    assert.equal(gate({ vaccine: national.vaccineConceptUuids.BCG, evaluationDate: '2024-06-01', encounters: [], patientId: '' }), 'allowed');
  });
});

describe('TT and Td are one sequence', () => {
  const pregnant = [pregnancyEncounter('2024-05-01T08:00:00.000Z', trimesters[0])];

  it('counts TT1 through TT5 as Td1 through Td5', () => {
    for (const sequence of [1, 2, 3, 4, 5] as const) {
      assert.equal(gate({
        vaccine: td(sequence),
        evaluationDate: '2024-06-01',
        encounters: [...pregnant, ttEncounter(tt(sequence), '2024-01-01')],
      }), 'already-given');
    }
  });

  it('counts a Td dose recorded on the Immunization form', () => {
    assert.equal(gate({
      vaccine: td(1),
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, tdEncounter(td(1), '2024-02-01T10:00:00.000Z')],
    }), 'already-given');
  });

  it('counts a Td dose recorded as a FHIR Immunization resource (the LE-561/LE-565 reconciliation)', () => {
    // Before this history was read through evaluateSequence, decideTdGate never looked at FHIR
    // history at all, so a dose recorded through the O3 Immunizations workspace was invisible to
    // this gate and could be re-recorded as a second, conflicting administration.
    assert.equal(gate({
      vaccine: td(2),
      evaluationDate: '2024-06-01',
      fhir: [fhirDose(td(2), '2024-02-01', 'fhir-td2')],
      encounters: [...pregnant, ttEncounter(tt(1), '2024-01-01')],
    }), 'already-given');
  });

  it('coalesces a FHIR Td record and an ANC TT record of the same dose on the same date', () => {
    const earlyPregnant = [pregnancyEncounter('2024-01-02T08:00:00.000Z', trimesters[0])];
    assert.equal(gate({
      vaccine: td(1),
      evaluationDate: '2024-01-29',
      fhir: [fhirDose(td(1), '2024-01-01', 'fhir-td1')],
      encounters: [...earlyPregnant, ttEncounter(tt(1), '2024-01-01')],
    }), 'already-given');
    assert.equal(gate({
      vaccine: td(2),
      evaluationDate: '2024-01-29',
      fhir: [fhirDose(td(1), '2024-01-01', 'fhir-td1')],
      encounters: [...earlyPregnant, ttEncounter(tt(1), '2024-01-01')],
    }), 'allowed');
  });

  it('treats a FHIR Td record and a conflicting ANC TT date for the same dose as unresolved', () => {
    assert.equal(gate({
      vaccine: td(2),
      evaluationDate: '2024-06-01',
      fhir: [fhirDose(td(1), '2024-01-01', 'fhir-td1')],
      encounters: [...pregnant, ttEncounter(tt(1), '2024-02-01')],
    }), 'history-conflict');
  });

  it('does not count the same canonical dose twice when TT and Td share a date', () => {
    const encounters = [
      pregnancyEncounter('2024-01-02T08:00:00.000Z', trimesters[0], 'early-pregnancy'),
      ttEncounter(tt(1), '2024-01-01'),
      tdEncounter(td(1), '2024-01-01T11:00:00.000Z'),
    ];
    assert.equal(tdIntervalDate('2024-01-01', 2), '2024-01-29');
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-01-29', encounters }), 'allowed');
  });

  it('fails closed when equivalent representations have different dates', () => {
    const encounters = [
      ...pregnant,
      ttEncounter(tt(1), '2024-01-01'),
      tdEncounter(td(1), '2024-02-01T10:00:00.000Z'),
    ];
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-06-01', encounters }), 'history-conflict');
    assert.equal(gate({
      vaccine: td(1),
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, tdEncounter(td(1), '2024-01-01T10:00:00.000Z', 'first'), tdEncounter(td(1), '2024-03-01T10:00:00.000Z', 'second')],
    }), 'history-conflict');
  });

  it('classifies an unreadable mapped date the same way in either encounter order', () => {
    const unreadable: TdHistoryEncounter = {
      uuid: 'unreadable-tt2', patient: { uuid: patientUuid },
      form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
      encounterDatetime: '2024-04-01T10:00:00.000Z',
      obs: [{ uuid: 'obs-unreadable-tt2', concept: { uuid: tt(2) }, value: 'not-a-date' }],
    };
    const dose1 = ttEncounter(tt(1), '2024-01-01');
    assert.equal(gate({ vaccine: td(3), evaluationDate: '2024-06-01', encounters: [...pregnant, dose1, unreadable] }), 'unresolved');
    assert.equal(gate({ vaccine: td(3), evaluationDate: '2024-06-01', encounters: [...pregnant, unreadable, dose1] }), 'unresolved');
  });

  it('fails closed when a mapped dose has no usable date', () => {
    const encounters = [
      ...pregnant,
      {
        uuid: 'bad-tt1', patient: { uuid: patientUuid },
        form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
        encounterDatetime: '2024-02-01T10:00:00.000Z',
        obs: [{ uuid: 'obs-bad-tt1', concept: { uuid: tt(1) }, value: 'not-a-date' }],
      } as TdHistoryEncounter,
    ];
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-06-01', encounters }), 'unresolved');
  });

  it('ignores Td answers that were not recorded on the Immunization form', () => {
    const elsewhere: TdHistoryEncounter = {
      uuid: 'elsewhere', patient: { uuid: patientUuid },
      form: { uuid: 'some-other-form' },
      encounterDatetime: '2024-02-01T10:00:00.000Z',
      obs: [{ uuid: 'obs-elsewhere', concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: td(1) } }],
    };
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: [...pregnant, elsewhere] }), 'allowed');
  });

  it('does not treat the dose being edited as already given', () => {
    const current = tdEncounter(td(1), '2024-02-01T10:00:00.000Z', 'editing');
    assert.equal(gate({
      vaccine: td(1),
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, current],
      editingEncounterUuid: 'editing',
    }), 'allowed');
    assert.equal(gate({
      vaccine: td(1),
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, current],
    }), 'already-given');
  });
});

describe('Td sequence intervals', () => {
  const pregnant = [pregnancyEncounter('2024-01-02T08:00:00.000Z', trimesters[1])];

  it('applies the Td2 interval after TT1', () => {
    const encounters = [...pregnant, ttEncounter(tt(1), '2024-01-01')];
    assert.equal(tdIntervalDate('2024-01-01', 2), '2024-01-29');
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-01-28', encounters }), 'too-soon');
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-01-29', encounters }), 'allowed');
  });

  it('applies the Td3 interval after TT2', () => {
    const encounters = [...pregnant, ttEncounter(tt(2), '2024-01-15')];
    assert.equal(tdIntervalDate('2024-01-15', 3), '2024-07-15');
    assert.equal(gate({ vaccine: td(3), evaluationDate: '2024-07-14', encounters }), 'too-soon');
    assert.equal(gate({ vaccine: td(3), evaluationDate: '2024-07-15', encounters }), 'allowed');
  });

  it('applies the one-year intervals after TT3 and TT4', () => {
    assert.equal(tdIntervalDate('2024-01-31', 4), '2025-01-31');
    assert.equal(tdIntervalDate('2024-02-29', 5), '2025-02-28');
    assert.equal(gate({
      vaccine: td(4),
      evaluationDate: '2025-01-30',
      encounters: [...pregnant, ttEncounter(tt(3), '2024-01-31')],
    }), 'too-soon');
    assert.equal(gate({
      vaccine: td(4),
      evaluationDate: '2025-01-31',
      encounters: [...pregnant, ttEncounter(tt(3), '2024-01-31')],
    }), 'allowed');
    const td5History = [pregnancyEncounter('2025-02-01T08:00:00.000Z', trimesters[2]), ttEncounter(tt(4), '2024-02-29')];
    assert.equal(gate({ vaccine: td(5), evaluationDate: '2025-02-27', encounters: td5History }), 'too-soon');
    assert.equal(gate({ vaccine: td(5), evaluationDate: '2025-02-28', encounters: td5History }), 'allowed');
  });

  it('still blocks Td when pregnancy is not confirmed even if the interval would allow it', () => {
    const encounters = [ttEncounter(tt(1), '2024-01-01')];
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-06-01', encounters }), 'unknown-pregnancy');
  });

  it('blocks Td when pregnancy status or history cannot be established', () => {
    const pregnantHistory = [pregnancyEncounter('2024-05-01T08:00:00.000Z', trimesters[0]), ttEncounter(tt(1), '2024-01-01')];
    assert.equal(gate({ vaccine: td(2), evaluationDate: '2024-06-01', encounters: pregnantHistory, historyComplete: false }), 'unresolved');
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: pregnant, patientId: ' ' }), 'unresolved');
    assert.equal(gate({ vaccine: td(1), evaluationDate: '2024-06-01', encounters: pregnant, birth: '' }), 'unresolved');
  });
});
