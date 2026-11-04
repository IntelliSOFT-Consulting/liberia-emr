import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ALREADY_RECORDED_VACCINE_MESSAGE,
  IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE,
  alreadyCapturedDoseMessage,
  canonicalDoseForVaccineConcept,
  evaluateAlreadyCapturedDose,
  evaluateAlreadyCapturedDoseFromChart,
  specializedDuplicateGateOwns,
  type AlreadyCapturedCode,
} from './already-captured.ts';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import { evaluateSequence } from './sequence.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const patientUuid = 'patient-1';
const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const birth = '2024-01-01';
const adultBirth = '1990-01-01';
const givenOn = '2024-02-01';
const later = '2024-06-01';
const fhirBaseUrl = 'http://openmrs.local/ws/fhir2/R4';
const restBaseUrl = 'http://openmrs.local/ws/rest/v1';
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

function concept(id: string) {
  const uuid = national.vaccineConceptUuids[id];
  assert.ok(uuid, id);
  return uuid;
}

function fhir(
  conceptUuid: string,
  date: string,
  id: string,
  status = 'completed',
  patient = patientUuid,
): FhirImmunization {
  return {
    resourceType: 'Immunization',
    id,
    status,
    patient: { reference: `Patient/${patient}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function encounter(
  conceptUuid: string,
  date: string,
  obsId: string,
  formUuid = national.nationalFormUuids.at(-1)!,
): NationalEncounter {
  return {
    uuid: `enc-${obsId}`,
    patient: { uuid: patientUuid },
    form: { uuid: formUuid },
    encounterDatetime: date,
    obs: [{ uuid: obsId, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function ttEncounter(date: string, obsId: string): NationalEncounter {
  return {
    uuid: `enc-${obsId}`,
    patient: { uuid: patientUuid },
    form: { uuid: national.ancFormUuids[0] },
    encounterDatetime: '2020-01-01T00:00:00.000+0000',
    obs: [{ uuid: obsId, concept: { uuid: national.ancTtConceptUuids.TD1 }, value: date }],
  };
}

function decide(input: {
  vaccine: string;
  birthDate?: string;
  evaluationDate?: string;
  fhir?: readonly FhirImmunization[] | null;
  encounters?: readonly NationalEncounter[] | null;
  editingEncounterUuid?: string;
  config?: SequenceIdentityConfig;
  patient?: string;
}): AlreadyCapturedCode {
  return evaluateAlreadyCapturedDose({
    patientUuid: input.patient ?? patientUuid,
    birthDate: input.birthDate ?? birth,
    evaluationDate: input.evaluationDate ?? later,
    vaccineConceptUuid: input.vaccine,
    fhir: input.fhir === undefined ? [] : input.fhir,
    encounters: input.encounters === undefined ? [] : input.encounters,
    config: input.config ?? national,
    editingEncounterUuid: input.editingEncounterUuid,
  });
}

describe('already captured vaccine', () => {
  it('blocks BCG already stored as a completed FHIR immunization', () => {
    assert.equal(decide({ vaccine: concept('BCG'), fhir: [fhir(concept('BCG'), givenOn, 'bcg')] }), 'already-given');
  });

  it('blocks BCG already stored on a national Immunization encounter', () => {
    assert.equal(decide({
      vaccine: concept('BCG'),
      encounters: [encounter(concept('BCG'), givenOn, 'bcg-obs', national.nationalFormUuids[0])],
    }), 'already-given');
    const grouped = encounter(concept('BCG'), givenOn, 'bcg-grouped');
    grouped.obs = [{
      uuid: 'group-1',
      concept: { uuid: 'administration-group' },
      groupMembers: grouped.obs,
    }];
    assert.equal(decide({ vaccine: concept('BCG'), encounters: [grouped] }), 'already-given');
  });

  it('blocks a repeated OPV1 and still allows OPV2 when OPV1 is the only recorded dose', () => {
    const prior = [fhir(concept('OPV1'), givenOn, 'opv1')];
    assert.equal(decide({ vaccine: concept('OPV1'), fhir: prior }), 'already-given');
    assert.equal(decide({
      vaccine: concept('OPV2'), birthDate: birth, evaluationDate: '2024-02-29', fhir: prior,
    }), 'allowed');
    assert.equal(evaluateSequence({
      patientUuid, doseId: 'OPV2', birthDate: birth, evaluationDate: '2024-02-29',
      fhir: prior, encounters: [], config: national,
    }).status, 'DUE');
  });

  it('blocks a repeated Penta1 and does not treat Penta2 as that same dose', () => {
    const prior = [fhir(concept('Penta1'), givenOn, 'penta1')];
    assert.equal(decide({ vaccine: concept('Penta1'), fhir: prior }), 'already-given');
    assert.equal(decide({ vaccine: concept('Penta2'), fhir: prior }), 'allowed');
    assert.notEqual(concept('Penta1'), concept('Penta2'));
  });

  it('blocks a repeated Penta2 and still allows Penta3', () => {
    const prior = [fhir(concept('Penta2'), givenOn, 'penta2')];
    assert.equal(decide({ vaccine: concept('Penta2'), fhir: prior }), 'already-given');
    assert.equal(decide({ vaccine: concept('Penta3'), fhir: prior }), 'allowed');
  });

  it('blocks MCV1 from FHIR or the national form and still allows MCV2', () => {
    const prior = [fhir(concept('MCV1'), givenOn, 'mcv1')];
    assert.equal(decide({ vaccine: concept('MCV1'), fhir: prior }), 'already-given');
    assert.equal(decide({
      vaccine: concept('MCV1'),
      encounters: [encounter(concept('MCV1'), givenOn, 'mcv1-form')],
    }), 'already-given');
    assert.equal(decide({ vaccine: concept('MCV2'), fhir: prior }), 'allowed');
  });

  it('leaves HPV1 and HPV2 to the HPV gate', () => {
    const prior = [fhir(concept('HPV1'), '2019-06-01', 'hpv1')];
    assert.equal(decide({
      vaccine: concept('HPV1'), birthDate: '2010-01-01', evaluationDate: '2019-06-01', fhir: prior,
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('HPV2'), birthDate: '2010-01-01', evaluationDate: '2020-01-01', fhir: prior,
    }), 'allowed');
    assert.equal(decide({ vaccine: concept('HPV1'), fhir: null }), 'allowed');
    assert.equal(specializedDuplicateGateOwns(concept('HPV1'), national), true);
    assert.equal(specializedDuplicateGateOwns(concept('HPV2'), national), true);
  });

  it('leaves every Td dose to the Td gate, including TT history', () => {
    assert.equal(decide({
      vaccine: concept('TD1'), birthDate: adultBirth, encounters: [ttEncounter(givenOn, 'tt1')],
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('TD1'),
      birthDate: adultBirth,
      encounters: [encounter(concept('TD1'), givenOn, 'td1'), ttEncounter(givenOn, 'tt1-same-day')],
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('TD2'), birthDate: adultBirth, encounters: [ttEncounter(givenOn, 'tt1-only')], fhir: null,
    }), 'allowed');
    assert.equal(specializedDuplicateGateOwns(concept('TD1'), national), true);
    assert.equal(specializedDuplicateGateOwns(concept('TD5'), national), true);
  });

  it('leaves Pediatric Pfizer dose 1 and dose 2 to the Pediatric Pfizer gate', () => {
    const dose1 = concept('PediatricPfizer1');
    const prior = [fhir(dose1, '2025-12-20', 'pfizer-1')];
    assert.equal(decide({
      vaccine: dose1, birthDate: '2014-01-01', evaluationDate: '2026-01-17', fhir: prior,
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('PediatricPfizer2'), birthDate: '2014-01-01', evaluationDate: '2026-01-17', fhir: prior,
    }), 'allowed');
    assert.equal(decide({ vaccine: dose1, fhir: null }), 'allowed');
    assert.equal(specializedDuplicateGateOwns(dose1, national), true);
    assert.equal(specializedDuplicateGateOwns(concept('PediatricPfizer2'), national), true);
    assert.equal(specializedDuplicateGateOwns(concept('BCG'), national), false);
  });

  it('allows a new dose when history has no copy of it', () => {
    assert.equal(decide({ vaccine: concept('OPV1') }), 'allowed');
    assert.equal(decide({ vaccine: concept('BCG') }), 'allowed');
    assert.equal(decide({ vaccine: concept('MCV2') }), 'allowed');
    assert.equal(decide({ vaccine: concept('Pfizer') }), 'allowed');
    assert.equal(alreadyCapturedDoseMessage('allowed'), '');
  });

  it('does not count an AEFI vaccine mention, a voided obs, or a non-completed FHIR status', () => {
    const aefi: NationalEncounter = {
      uuid: 'aefi-enc',
      patient: { uuid: patientUuid },
      form: { uuid: variable('var.form.aefi.uuid') },
      encounterDatetime: givenOn,
      obs: [{
        uuid: 'aefi-bcg',
        concept: { uuid: variable('var.concept.national.aefi-vaccine.uuid') },
        value: { uuid: concept('BCG') },
      }],
    };
    assert.equal(decide({ vaccine: concept('BCG'), encounters: [aefi] }), 'allowed');
    const voidedObs = encounter(concept('BCG'), givenOn, 'voided-bcg');
    voidedObs.obs![0].voided = true;
    assert.equal(decide({ vaccine: concept('BCG'), encounters: [voidedObs] }), 'allowed');
    assert.equal(decide({
      vaccine: concept('BCG'),
      encounters: [{ ...encounter(concept('BCG'), givenOn, 'voided-enc'), voided: true }],
    }), 'allowed');
    for (const status of ['not-done', 'entered-in-error']) {
      assert.equal(decide({
        vaccine: concept('OPV1'), fhir: [fhir(concept('OPV1'), givenOn, `opv-${status}`, status)],
      }), 'allowed');
    }
  });

  it('ignores the encounter being edited and still blocks a different encounter', () => {
    const editing = encounter(concept('BCG'), givenOn, 'editing-bcg');
    const other = encounter(concept('OPV1'), givenOn, 'other-opv');
    assert.equal(decide({
      vaccine: concept('BCG'), encounters: [editing], editingEncounterUuid: editing.uuid,
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('OPV1'),
      birthDate: birth,
      encounters: [other, encounter(concept('OPV1'), '2024-03-01', 'second-opv')],
      editingEncounterUuid: other.uuid,
    }), 'already-given');
    assert.equal(decide({
      vaccine: concept('BCG'),
      fhir: [fhir(concept('BCG'), givenOn, 'fhir-bcg')],
      encounters: [editing],
      editingEncounterUuid: editing.uuid,
    }), 'already-given');
  });

  it('coalesces the same canonical dose from FHIR and the national form on one clinical date', () => {
    assert.equal(decide({
      vaccine: concept('OPV1'),
      fhir: [fhir(concept('OPV1'), givenOn, 'fhir-opv1')],
      encounters: [encounter(concept('OPV1'), givenOn, 'form-opv1')],
    }), 'already-given');
    assert.equal(decide({
      vaccine: concept('BCG'),
      fhir: [fhir(concept('BCG'), givenOn, 'fhir-bcg')],
      encounters: [encounter(concept('BCG'), givenOn, 'form-bcg')],
    }), 'already-given');
  });

  it('fails closed when the same dose has conflicting dates or history cannot be read', () => {
    assert.equal(decide({
      vaccine: concept('OPV1'),
      fhir: [fhir(concept('OPV1'), givenOn, 'one'), fhir(concept('OPV1'), '2024-02-02', 'two')],
    }), 'unresolved');
    assert.equal(decide({
      vaccine: concept('BCG'),
      fhir: [fhir(concept('BCG'), givenOn, 'bcg-1'), fhir(concept('BCG'), '2024-03-01', 'bcg-2')],
    }), 'unresolved');
    assert.equal(decide({ vaccine: concept('BCG'), fhir: null, encounters: [] }), 'unresolved');
    assert.equal(decide({ vaccine: concept('OPV1'), fhir: [], encounters: null }), 'unresolved');
    assert.equal(decide({
      vaccine: concept('BCG'),
      fhir: [fhir('not-a-known-vaccine', givenOn, 'unknown')],
    }), 'unresolved');
    assert.equal(decide({
      vaccine: concept('BCG'),
      fhir: [{ ...fhir(concept('OPV1'), givenOn, 'bad-opv'), occurrenceDateTime: undefined }],
    }), 'allowed');
    assert.equal(alreadyCapturedDoseMessage('unresolved'), IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE);
    assert.notEqual(IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE, ALREADY_RECORDED_VACCINE_MESSAGE);
  });

  it('does not classify an unknown concept as a duplicate', () => {
    assert.equal(decide({
      vaccine: 'not-a-known-vaccine',
      fhir: [fhir(concept('BCG'), givenOn, 'bcg')],
    }), 'allowed');
    assert.equal(decide({ vaccine: '  ', fhir: null }), 'allowed');
    assert.equal(canonicalDoseForVaccineConcept('not-a-known-vaccine', national).status, 'unknown');
    assert.equal(alreadyCapturedDoseMessage('allowed'), '');
    assert.equal(alreadyCapturedDoseMessage('already-given'), ALREADY_RECORDED_VACCINE_MESSAGE);
    const shared = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const ambiguous: SequenceIdentityConfig = {
      ...national,
      vaccineConceptUuids: { ...national.vaccineConceptUuids, OPV1: shared, OPV2: shared },
    };
    assert.equal(decide({
      vaccine: shared, config: ambiguous, fhir: [],
    }), 'unresolved');
    assert.notEqual(decide({ vaccine: shared, config: ambiguous }), 'already-given');
  });

  it('supports recognized doses that are outside the routine schedule', () => {
    assert.equal(decide({
      vaccine: concept('Pfizer'), fhir: [fhir(concept('Pfizer'), givenOn, 'adult-pfizer')],
    }), 'already-given');
    assert.equal(decide({
      vaccine: concept('JJ'), fhir: [fhir(concept('Pfizer'), givenOn, 'adult-pfizer')],
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('BCG'), fhir: [fhir(concept('JJ'), givenOn, 'jj')],
    }), 'allowed');
    assert.equal(decide({
      vaccine: concept('Pfizer'),
      fhir: [fhir(concept('Pfizer'), givenOn, 'pfizer-a'), fhir(concept('Pfizer'), '2024-03-01', 'pfizer-b')],
    }), 'unresolved');
    assert.equal(decide({
      vaccine: concept('Pfizer'),
      fhir: [fhir(concept('Pfizer'), givenOn, 'pfizer-fhir')],
      encounters: [encounter(concept('Pfizer'), givenOn, 'pfizer-form')],
    }), 'already-given');
  });
});

describe('chart load', () => {
  function bundle(records: FhirImmunization[]) {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: records.length,
      entry: records.map((resource) => ({ resource })),
    };
  }

  function fromChart(input: {
    vaccine: string;
    fhir?: FhirImmunization[];
    encounters?: NationalEncounter[];
    fetchPage?: (url: string) => Promise<unknown>;
    patient?: string;
  }) {
    const calls: string[] = [];
    const result = evaluateAlreadyCapturedDoseFromChart({
      patientUuid: input.patient ?? patientUuid,
      birthDate: birth,
      evaluationDate: later,
      vaccineConceptUuid: input.vaccine,
      config: national,
      fhirBaseUrl,
      restBaseUrl,
      fetchPage: input.fetchPage ?? (async (url) => {
        calls.push(url);
        if (url.includes('/Immunization')) return bundle(input.fhir ?? []);
        return { results: input.encounters ?? [] };
      }),
    });
    return { calls, result };
  }

  it('blocks a chart BCG and fails closed when the history pages cannot be read', async () => {
    const recorded = fromChart({ vaccine: concept('BCG'), fhir: [fhir(concept('BCG'), givenOn, 'bcg')] });
    assert.equal(await recorded.result, 'already-given');
    assert.equal(recorded.calls.length, 2);
    const down = fromChart({
      vaccine: concept('BCG'),
      fetchPage: async () => { throw new Error('history down'); },
    });
    assert.equal(await down.result, 'unresolved');
    assert.equal(alreadyCapturedDoseMessage(await down.result), IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE);
  });

  it('does not fetch or fail closed for Td, Pediatric Pfizer, or HPV, including a history outage', async () => {
    const historyDown = async () => { throw new Error('history down'); };
    for (const vaccine of [
      concept('TD1'), concept('PediatricPfizer1'), concept('PediatricPfizer2'), concept('HPV1'), concept('HPV2'),
    ]) {
      const deferred = fromChart({ vaccine, fetchPage: historyDown, fhir: [fhir(vaccine, givenOn, 'present')] });
      assert.equal(await deferred.result, 'allowed');
      assert.deepEqual(deferred.calls, []);
    }
  });

  it('fails closed for another patient and does not fetch an unknown concept', async () => {
    const other = fromChart({
      vaccine: concept('BCG'),
      patient: 'patient-a',
      fhir: [fhir(concept('BCG'), givenOn, 'bcg', 'completed', 'patient-b')],
    });
    assert.equal(await other.result, 'unresolved');
    const unknown = fromChart({
      vaccine: 'not-a-known-vaccine',
      fetchPage: async () => { throw new Error('should not fetch'); },
    });
    assert.equal(await unknown.result, 'allowed');
    assert.deepEqual(unknown.calls, []);
  });
});

describe('Immunization form wiring', () => {
  it('registers the gate once on Immunization v1.14 and keeps the previous identity', () => {
    const indexSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const registrations = indexSource.match(/registerFormEngineExpressionHelper\('alreadyCapturedVaccineGate'/g) ?? [];
    assert.equal(registrations.length, 1);
    const form = JSON.parse(readFileSync(new URL(
      '../../../../content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
      import.meta.url,
    ), 'utf8')) as { version: string; pages: Array<{ sections: Array<{ questions?: unknown[] }> }> };
    assert.equal(form.version, '1.14');
    const flat: Array<{ id?: string; questionOptions?: { calculate?: { calculateExpression?: string } }; validators?: Array<{ failsWhenExpression?: string; message?: string }> }> = [];
    const visit = (items: unknown[] | undefined) => {
      for (const item of items ?? []) {
        const question = item as { id?: string; questions?: unknown[] };
        flat.push(question as typeof flat[number]);
        if (Array.isArray(question.questions)) visit(question.questions);
      }
    };
    for (const page of form.pages) {
      for (const section of page.sections) visit(section.questions);
    }
    const gate = flat.find((question) => question.id === 'already_captured_gate');
    assert.equal(
      gate?.questionOptions?.calculate?.calculateExpression,
      "alreadyCapturedVaccineGate(patient.id, patient.birthDate, tdEncounterDate, vaccine_name, vitaminAEditingEncounterUuid()).then(code => code)",
    );
    const route = flat.find((question) => question.id === 'route');
    const messages = new Map((route?.validators ?? []).map((validator) => [validator.message, validator.failsWhenExpression]));
    assert.match(messages.get(ALREADY_RECORDED_VACCINE_MESSAGE) ?? '', /already_captured_gate === 'already-given'/);
    assert.match(messages.get(IMMUNIZATION_HISTORY_UNAVAILABLE_MESSAGE) ?? '', /already_captured_gate === 'unresolved'/);
    assert.match(messages.get(ALREADY_RECORDED_VACCINE_MESSAGE) ?? '', /!isTdVaccine\(/);
    assert.match(messages.get(ALREADY_RECORDED_VACCINE_MESSAGE) ?? '', /!isPediatricPfizerDose\(/);
    assert.match(messages.get(ALREADY_RECORDED_VACCINE_MESSAGE) ?? '', /!isHpvDose\(/);
    assert.equal(messages.get('This Td dose is already recorded.')?.includes('alreadyCapturedVaccineGate'), false);
    assert.equal(messages.get('HPV1 is already given.')?.includes('already_captured_gate'), false);
    assert.equal(messages.get('Pediatric Pfizer dose 1 is already recorded.')?.includes('already_captured_gate'), false);
    const td = flat.find((question) => question.id === 'td_gate');
    assert.match(td?.questionOptions?.calculate?.calculateExpression ?? '', /^tdAdministrationGate\(/);
    const pfizer = flat.find((question) => question.id === 'pediatric_pfizer_gate');
    assert.match(pfizer?.questionOptions?.calculate?.calculateExpression ?? '', /^pediatricPfizerAdministrationGate\(/);
    const hpv = flat.find((question) => question.id === 'hpv_gate');
    assert.match(hpv?.questionOptions?.calculate?.calculateExpression ?? '', /^hpvAdministrationGate\(/);
    assert.equal(properties.get('var.form.immunization.uuid'), 'bcdd02a7-7a3a-303b-835d-79352d597eb9');
    assert.equal(properties.get('var.form.immunization.v1-13.uuid'), '0d652152-7780-3b5e-a3fe-f6921a5f795b');
    assert.equal(national.nationalFormUuids.includes('0d652152-7780-3b5e-a3fe-f6921a5f795b'), true);
    assert.equal(national.nationalFormUuids.at(-1), 'bcdd02a7-7a3a-303b-835d-79352d597eb9');
    for (const name of ['already-captured.ts', 'already-captured-gate.ts']) {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      assert.equal(uuidLiteral.test(source), false, name);
    }
  });
});
