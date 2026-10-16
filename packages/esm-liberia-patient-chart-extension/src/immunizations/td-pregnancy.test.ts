import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LabourEpisodeConfig } from '../forms/labour-episode.ts';
import {
  classifyCurrentPregnancy,
  collectEncounterPages,
  decideTdGate,
  immunizationEncounterPagePath,
  isTdVaccine,
  monroviaCalendarDate,
  readTdHistory,
  tdConceptsFromFormArgs,
  tdIntervalDate,
  type TdConcepts,
  type TdHistoryEncounter,
} from './td-pregnancy.ts';

const concepts: TdConcepts = tdConceptsFromFormArgs(
  'pregnancy-status',
  'trimester-1',
  'trimester-2',
  'trimester-3',
  'vaccine-name',
  'td1',
  'tt1',
  'td2',
  'tt2',
  'td3',
  'tt3',
  'td4',
  'tt4',
  'td5',
  'tt5',
);

const episodeConfig: LabourEpisodeConfig = { deliveryEncounterTypeUuid: 'delivery-type' };
const birthDate = '1990-01-01';

function encounter(input: {
  id?: string;
  datetime: string;
  formName?: string;
  type?: string;
  obs?: TdHistoryEncounter['obs'];
}): TdHistoryEncounter {
  return {
    uuid: input.id ?? input.datetime,
    encounterDatetime: input.datetime,
    encounterType: input.type ? { uuid: input.type } : undefined,
    form: input.formName ? { name: input.formName } : undefined,
    obs: input.obs,
  };
}

function pregnancy(datetime: string, value: string, id = datetime): TdHistoryEncounter {
  return encounter({
    id,
    datetime,
    formName: 'ANC Initial Visit',
    obs: [{ uuid: `${id}-status`, concept: { uuid: 'pregnancy-status' }, value: { uuid: value } }],
  });
}

function tt(concept: string, date: string, datetime = `${date}T09:00:00.000Z`): TdHistoryEncounter {
  return encounter({
    id: `tt-${concept}-${date}`,
    datetime,
    formName: '1. ANC Form',
    obs: [{ uuid: `obs-${concept}-${date}`, concept: { uuid: concept }, value: date }],
  });
}

function tdDose(concept: string, datetime: string, id = `imm-${concept}-${datetime}`): TdHistoryEncounter {
  return encounter({
    id,
    datetime,
    formName: 'Immunization',
    obs: [{ uuid: `${id}-obs`, concept: { uuid: 'vaccine-name' }, value: { uuid: concept } }],
  });
}

function gate(input: {
  vaccine: string;
  evaluationDate: string;
  encounters?: readonly TdHistoryEncounter[];
  historyComplete?: boolean;
  patientId?: string;
  editingEncounterUuid?: string;
  birth?: string;
}) {
  return decideTdGate({
    patientId: input.patientId === undefined ? 'patient-1' : input.patientId,
    birthDate: input.birth === undefined ? birthDate : input.birth,
    evaluationDate: input.evaluationDate,
    vaccineConceptUuid: input.vaccine,
    editingEncounterUuid: input.editingEncounterUuid,
    concepts,
    encounters: input.encounters ?? [],
    episodeConfig,
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
  const pregnant = [pregnancy('2024-05-01T08:00:00.000Z', 'trimester-2')];

  it('lets a confirmed pregnancy proceed to Td1', () => {
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: pregnant }), 'allowed');
  });

  it('treats each trimester as pregnant', () => {
    for (const value of ['trimester-1', 'trimester-2', 'trimester-3']) {
      assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: [pregnancy('2024-05-01T08:00:00.000Z', value)] }), 'allowed');
    }
  });

  it('blocks unknown, missing, and unreadable pregnancy status', () => {
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: [] }), 'unknown-pregnancy');
    for (const value of ['some-other-code', 'ciel-1065', 'ciel-1066']) {
      assert.equal(gate({
        vaccine: 'td1',
        evaluationDate: '2024-06-01',
        encounters: [pregnancy('2024-05-01T08:00:00.000Z', value)],
      }), 'unknown-pregnancy');
    }
  });

  it('does not carry pregnancy across a delivery', () => {
    const encounters = [
      pregnancy('2024-01-10T08:00:00.000Z', 'trimester-3', 'old-pregnancy'),
      encounter({ id: 'delivery', datetime: '2024-03-01T08:00:00.000Z', type: 'delivery-type' }),
    ];
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters }), 'unknown-pregnancy');
    encounters.push(pregnancy('2024-04-02T08:00:00.000Z', 'trimester-1', 'current-pregnancy'));
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters }), 'allowed');
  });

  it('fails closed when the latest pregnancy-status values disagree', () => {
    const datetime = '2024-05-01T08:00:00.000Z';
    const mixed = encounter({
      datetime,
      formName: 'ANC Follow-up Visit',
      obs: [
        { concept: { uuid: 'pregnancy-status' }, value: { uuid: 'trimester-1' } },
        { concept: { uuid: 'pregnancy-status' }, value: { uuid: 'ciel-1066' } },
      ],
    });
    assert.equal(classifyCurrentPregnancy({
      encounters: [mixed],
      config: episodeConfig,
      evaluationTime: Date.parse('2024-06-01T23:59:59.999Z'),
      concepts,
    }), 'unknown');
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: [mixed] }), 'unknown-pregnancy');
  });

  it('does not block an unrelated vaccine', () => {
    const conflict = [
      pregnancy('2024-05-01T08:00:00.000Z', 'trimester-2'),
      tt('tt1', '2024-01-01'),
      tdDose('td1', '2024-02-01T10:00:00.000Z'),
    ];
    assert.equal(gate({ vaccine: 'opv', evaluationDate: '2024-06-01', encounters: conflict, historyComplete: false }), 'allowed');
    assert.equal(gate({ vaccine: 'bcg', evaluationDate: '2024-06-01', encounters: [], patientId: '' }), 'allowed');
  });
});

describe('TT and Td are one sequence', () => {
  const pregnant = [pregnancy('2024-05-01T08:00:00.000Z', 'trimester-1')];

  it('counts TT1 through TT5 as Td1 through Td5', () => {
    const pairs = [
      ['tt1', 'td1'],
      ['tt2', 'td2'],
      ['tt3', 'td3'],
      ['tt4', 'td4'],
      ['tt5', 'td5'],
    ] as const;
    for (const [ttConcept, tdConcept] of pairs) {
      assert.equal(gate({
        vaccine: tdConcept,
        evaluationDate: '2024-06-01',
        encounters: [...pregnant, tt(ttConcept, '2024-01-01')],
      }), 'already-given');
    }
  });

  it('counts a Td dose recorded on the Immunization form', () => {
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, tdDose('td1', '2024-02-01T10:00:00.000Z')],
    }), 'already-given');
  });

  it('does not count the same canonical dose twice when TT and Td share a date', () => {
    const encounters = [
      pregnancy('2024-01-02T08:00:00.000Z', 'trimester-1', 'early-pregnancy'),
      tt('tt1', '2024-01-01'),
      tdDose('td1', '2024-01-01T11:00:00.000Z'),
    ];
    const history = readTdHistory({ encounters, concepts });
    assert.equal(history.ok, true);
    if (history.ok) {
      assert.equal(history.doses.length, 1);
      assert.equal(history.doses[0].administeredDate, '2024-01-01');
    }
    assert.equal(tdIntervalDate('2024-01-01', 2), '2024-01-29');
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-01-29', encounters }), 'allowed');
  });

  it('fails closed when equivalent representations have different dates', () => {
    const encounters = [
      ...pregnant,
      tt('tt1', '2024-01-01'),
      tdDose('td1', '2024-02-01T10:00:00.000Z'),
    ];
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-06-01', encounters }), 'history-conflict');
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, tdDose('td1', '2024-01-01T10:00:00.000Z', 'first'), tdDose('td1', '2024-03-01T10:00:00.000Z', 'second')],
    }), 'history-conflict');
  });

  it('classifies an unreadable mapped date the same way in either encounter order', () => {
    const unreadable = encounter({
      id: 'unreadable-tt2',
      datetime: '2024-04-01T10:00:00.000Z',
      formName: '1. ANC Form',
      obs: [{ concept: { uuid: 'tt2' }, value: 'not-a-date' }],
    });
    const earlier = tt('tt1', '2024-01-01');
    const later = tt('tt1', '2024-02-01');
    const forward = readTdHistory({ encounters: [earlier, later, unreadable], concepts });
    const reverse = readTdHistory({ encounters: [unreadable, later, earlier], concepts });
    assert.deepEqual(forward, { ok: false, code: 'unresolved' });
    assert.deepEqual(reverse, forward);

    const sameDose = encounter({
      id: 'unreadable-tt1',
      datetime: '2024-03-01T10:00:00.000Z',
      formName: '1. ANC Form',
      obs: [{ concept: { uuid: 'tt1' }, value: 'not-a-date' }],
    });
    const valid = tt('tt1', '2024-01-01');
    assert.deepEqual(readTdHistory({ encounters: [valid, sameDose], concepts }), { ok: false, code: 'unresolved' });
    assert.deepEqual(readTdHistory({ encounters: [sameDose, valid], concepts }), { ok: false, code: 'unresolved' });
  });

  it('fails closed when a mapped dose has no usable date', () => {
    const encounters = [
      ...pregnant,
      encounter({
        datetime: '2024-02-01T10:00:00.000Z',
        formName: '1. ANC Form',
        obs: [{ concept: { uuid: 'tt1' }, value: 'not-a-date' }],
      }),
    ];
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-06-01', encounters }), 'unresolved');
  });

  it('ignores Td answers that were not recorded on the Immunization form', () => {
    const elsewhere = encounter({
      datetime: '2024-02-01T10:00:00.000Z',
      formName: 'OPD Consultation',
      obs: [{ concept: { uuid: 'vaccine-name' }, value: { uuid: 'td1' } }],
    });
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: [...pregnant, elsewhere] }), 'allowed');
  });

  it('does not treat the dose being edited as already given', () => {
    const current = tdDose('td1', '2024-02-01T10:00:00.000Z', 'editing');
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, current],
      editingEncounterUuid: 'editing',
    }), 'allowed');
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: [...pregnant, current],
    }), 'already-given');
  });
});

describe('Td sequence intervals', () => {
  const pregnant = [pregnancy('2024-01-02T08:00:00.000Z', 'trimester-2')];

  it('applies the Td2 interval after TT1', () => {
    const encounters = [...pregnant, tt('tt1', '2024-01-01')];
    assert.equal(tdIntervalDate('2024-01-01', 2), '2024-01-29');
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-01-28', encounters }), 'too-soon');
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-01-29', encounters }), 'allowed');
  });

  it('applies the Td3 interval after TT2', () => {
    const encounters = [...pregnant, tt('tt2', '2024-01-15')];
    assert.equal(tdIntervalDate('2024-01-15', 3), '2024-07-15');
    assert.equal(gate({ vaccine: 'td3', evaluationDate: '2024-07-14', encounters }), 'too-soon');
    assert.equal(gate({ vaccine: 'td3', evaluationDate: '2024-07-15', encounters }), 'allowed');
  });

  it('applies the one-year intervals after TT3 and TT4', () => {
    assert.equal(tdIntervalDate('2024-01-31', 4), '2025-01-31');
    assert.equal(tdIntervalDate('2024-02-29', 5), '2025-02-28');
    assert.equal(gate({
      vaccine: 'td4',
      evaluationDate: '2025-01-30',
      encounters: [...pregnant, tt('tt3', '2024-01-31')],
    }), 'too-soon');
    assert.equal(gate({
      vaccine: 'td4',
      evaluationDate: '2025-01-31',
      encounters: [...pregnant, tt('tt3', '2024-01-31')],
    }), 'allowed');
    const td5History = [pregnancy('2025-02-01T08:00:00.000Z', 'trimester-3'), tt('tt4', '2024-02-29')];
    assert.equal(gate({ vaccine: 'td5', evaluationDate: '2025-02-27', encounters: td5History }), 'too-soon');
    assert.equal(gate({ vaccine: 'td5', evaluationDate: '2025-02-28', encounters: td5History }), 'allowed');
  });

  it('still blocks Td when pregnancy is not confirmed even if the interval would allow it', () => {
    const encounters = [tt('tt1', '2024-01-01')];
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-06-01', encounters }), 'unknown-pregnancy');
  });

  it('blocks Td when pregnancy status or history cannot be established', () => {
    const pregnantHistory = [pregnancy('2024-05-01T08:00:00.000Z', 'trimester-1'), tt('tt1', '2024-01-01')];
    assert.equal(gate({ vaccine: 'td2', evaluationDate: '2024-06-01', encounters: pregnantHistory, historyComplete: false }), 'unresolved');
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: pregnant, patientId: ' ' }), 'unresolved');
    assert.equal(gate({ vaccine: 'td1', evaluationDate: '2024-06-01', encounters: pregnant, birth: '' }), 'unresolved');
  });
});

describe('encounter history paging', () => {
  function rows(count: number, idPrefix = 'row'): TdHistoryEncounter[] {
    return Array.from({ length: count }, (_, index) => encounter({
      id: `${idPrefix}-${index}`,
      datetime: '2020-01-01T08:00:00.000Z',
      formName: 'OPD Consultation',
    }));
  }

  it('treats 99 records with no next page as complete', async () => {
    let calls = 0;
    const loaded = await collectEncounterPages(async (startIndex, includeTotalCount) => {
      calls += 1;
      assert.equal(startIndex, 0);
      assert.equal(includeTotalCount, true);
      return { results: rows(99) };
    });
    assert.equal(calls, 1);
    assert.equal(loaded.complete, true);
    assert.equal(loaded.encounters.length, 99);
  });

  it('treats exactly 100 records with no next page as complete', async () => {
    let calls = 0;
    const loaded = await collectEncounterPages(async () => {
      calls += 1;
      return { results: rows(100) };
    });
    assert.equal(calls, 1);
    assert.equal(loaded.complete, true);
    assert.equal(loaded.encounters.length, 100);
  });

  it('keeps reading when exactly 100 records include a next page', async () => {
    const calls: Array<{ startIndex: number; includeTotalCount: boolean }> = [];
    const loaded = await collectEncounterPages(async (startIndex, includeTotalCount) => {
      calls.push({ startIndex, includeTotalCount });
      if (startIndex === 0) {
        return { results: rows(100), links: [{ rel: 'next', uri: '/ws/rest/v1/encounter?startIndex=100' }] };
      }
      return { results: rows(1, 'second') };
    });
    assert.deepEqual(calls, [
      { startIndex: 0, includeTotalCount: true },
      { startIndex: 100, includeTotalCount: false },
    ]);
    assert.equal(loaded.complete, true);
    assert.equal(loaded.encounters.length, 101);

    const byCount = await collectEncounterPages(async (startIndex) => {
      if (startIndex === 0) {
        return { results: rows(100, 'counted'), totalCount: 101 };
      }
      return { results: rows(1, 'counted-rest') };
    });
    assert.equal(byCount.complete, true);
    assert.equal(byCount.encounters.length, 101);
  });

  it('uses tetanus history loaded from the second page', async () => {
    const loaded = await collectEncounterPages(async (startIndex) => {
      if (startIndex === 0) {
        return {
          results: [pregnancy('2024-05-01T08:00:00.000Z', 'trimester-1'), ...rows(99)],
          totalCount: 101,
          links: [{ rel: 'next', uri: '/ws/rest/v1/encounter?startIndex=100' }],
        };
      }
      return { results: [tt('tt1', '2024-01-01')] };
    });
    assert.equal(loaded.complete, true);
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: loaded.encounters,
      historyComplete: loaded.complete,
    }), 'already-given');
  });

  it('blocks Td when a later page cannot be loaded', async () => {
    await assert.rejects(collectEncounterPages(async (startIndex) => {
      if (startIndex === 0) {
        return { results: rows(100), links: [{ rel: 'next' }] };
      }
      throw new Error('page failed');
    }));
    assert.equal(gate({
      vaccine: 'td1',
      evaluationDate: '2024-06-01',
      encounters: [pregnancy('2024-05-01T08:00:00.000Z', 'trimester-1')],
      historyComplete: false,
    }), 'unresolved');
  });

  it('asks the first encounter page for totalCount and does not treat a full page as truncated', () => {
    const first = new URLSearchParams(immunizationEncounterPagePath('patient 1', 0, true).split('?')[1]);
    const next = new URLSearchParams(immunizationEncounterPagePath('patient 1', 100, false).split('?')[1]);
    assert.equal(first.get('limit'), '100');
    assert.equal(first.get('startIndex'), '0');
    assert.equal(first.get('totalCount'), 'true');
    assert.equal(first.get('patient'), 'patient 1');
    assert.equal(next.get('startIndex'), '100');
    assert.equal(next.has('totalCount'), false);
  });
});
