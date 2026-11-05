import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { decideTtGate } from './anc-tt.ts';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

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

function td(id: 'TD1' | 'TD2' | 'TD3' | 'TD4' | 'TD5') {
  return national.vaccineConceptUuids[id];
}

function tt(id: 'TD1' | 'TD2' | 'TD3' | 'TD4' | 'TD5') {
  return national.ancTtConceptUuids[id];
}

function fhirDose(conceptUuid: string, date: string, id: string): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status: 'completed',
    patient: { reference: `Patient/${patientUuid}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function tdEncounter(conceptUuid: string, datetime: string, id = `imm-${conceptUuid}-${datetime}`): NationalEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    form: { uuid: national.nationalFormUuids[national.nationalFormUuids.length - 1] },
    encounterDatetime: datetime,
    obs: [{ uuid: `${id}-obs`, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function ttEncounter(ttConceptUuid: string, date: string, id = `tt-${ttConceptUuid}-${date}`): NationalEncounter {
  return {
    uuid: id, patient: { uuid: patientUuid },
    form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
    encounterDatetime: `${date}T09:00:00.000Z`,
    obs: [{ uuid: `obs-${id}`, concept: { uuid: ttConceptUuid }, value: date }],
  };
}

function gate(input: {
  canonicalDoseId: string;
  ttDate: string;
  fhir?: readonly FhirImmunization[];
  encounters?: readonly NationalEncounter[];
  editingEncounterUuid?: string;
  patientUuid?: string;
}) {
  return decideTtGate({
    patientUuid: input.patientUuid === undefined ? patientUuid : input.patientUuid,
    canonicalDoseId: input.canonicalDoseId,
    ttDate: input.ttDate,
    editingEncounterUuid: input.editingEncounterUuid,
    fhir: input.fhir ?? [],
    encounters: input.encounters ?? [],
    config: national,
  });
}

describe('ANC Date-of-TT save gate', () => {
  it('allows an empty date without reading the chart', () => {
    assert.equal(gate({ canonicalDoseId: 'TD1', ttDate: '' }), 'allowed');
    assert.equal(gate({ canonicalDoseId: 'TD1', ttDate: '', patientUuid: '' }), 'allowed');
  });

  it('is unresolved when the patient or canonical dose cannot be identified', () => {
    assert.equal(gate({ canonicalDoseId: 'TD1', ttDate: '2024-01-01', patientUuid: '' }), 'unresolved');
    assert.equal(gate({ canonicalDoseId: '', ttDate: '2024-01-01' }), 'unresolved');
    assert.equal(gate({ canonicalDoseId: 'OPV1', ttDate: '2024-01-01' }), 'unresolved');
  });

  it('allows the first time a dose is recorded', () => {
    assert.equal(gate({ canonicalDoseId: 'TD2', ttDate: '2024-01-01' }), 'allowed');
  });

  it('allows re-saving the same encounter with the same date (not a conflict)', () => {
    assert.equal(gate({
      canonicalDoseId: 'TD1',
      ttDate: '2024-01-01',
      encounters: [ttEncounter(tt('TD1'), '2024-01-01', 'this-encounter')],
    }), 'allowed');
  });

  it('flags a conflict when the new date disagrees with an existing Td record for the same dose', () => {
    assert.equal(gate({
      canonicalDoseId: 'TD1',
      ttDate: '2024-02-01',
      encounters: [tdEncounter(td('TD1'), '2024-01-01T10:00:00.000Z')],
    }), 'history-conflict');
  });

  it('flags a conflict against a dose recorded as a FHIR Immunization resource', () => {
    assert.equal(gate({
      canonicalDoseId: 'TD2',
      ttDate: '2024-02-01',
      fhir: [fhirDose(td('TD2'), '2024-01-15', 'fhir-td2')],
    }), 'history-conflict');
  });

  it('matches a FHIR-recorded dose on the same date without conflict', () => {
    assert.equal(gate({
      canonicalDoseId: 'TD2',
      ttDate: '2024-01-15',
      fhir: [fhirDose(td('TD2'), '2024-01-15', 'fhir-td2')],
    }), 'allowed');
  });

  it('does not treat the encounter being edited as existing history', () => {
    const current = ttEncounter(tt('TD3'), '2024-01-01', 'editing');
    assert.equal(gate({
      canonicalDoseId: 'TD3', ttDate: '2024-02-01',
      encounters: [current], editingEncounterUuid: 'editing',
    }), 'allowed');
    assert.equal(gate({
      canonicalDoseId: 'TD3', ttDate: '2024-02-01',
      encounters: [current],
    }), 'history-conflict');
  });

  it('is unresolved when history itself cannot be reconciled', () => {
    const badDate: NationalEncounter = {
      uuid: 'bad', patient: { uuid: patientUuid },
      form: { uuid: national.ancFormUuids[national.ancFormUuids.length - 1] },
      encounterDatetime: '2024-01-01T09:00:00.000Z',
      obs: [{ uuid: 'bad-obs', concept: { uuid: tt('TD4') }, value: 'not-a-date' }],
    };
    assert.equal(gate({ canonicalDoseId: 'TD4', ttDate: '2024-02-01', encounters: [badDate] }), 'unresolved');
  });
});
