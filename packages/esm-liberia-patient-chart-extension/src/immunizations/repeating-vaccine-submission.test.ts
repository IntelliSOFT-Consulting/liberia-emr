import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { administeredTimeline, normalizeHistory, type NationalEncounter, type NationalObs } from './history.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface Member {
  id: string;
  formFieldPath: string;
  concept: string | null;
  value: string | null;
  groupParent: string;
  row: string;
  transient: boolean;
  fieldType: string | null;
  hasUuid: boolean;
  hasVoided: boolean;
  conceptMissing: boolean;
  valuePresent: boolean;
}

interface Group {
  id: string;
  concept: string | null;
  formFieldPath: string;
  hasUuid: boolean;
  hasVoided: boolean;
  groupMembers: Member[];
}

interface FieldMeta {
  id: string;
  type: string;
  transient: boolean;
  concept: string | null;
  groupId: string | null;
  submissionValue: string | null;
  sharedWithGroupQuestions: boolean;
}

interface Probe {
  version: string;
  formVersion: string;
  concepts: {
    group: string;
    vaccine: string;
    route: string;
    returnDate: string;
    bcg: string;
    opv1: string;
    opv0: string;
    oral: string;
  };
  comparison: Record<string, FieldMeta>;
  single: Group[];
  two: Group[];
  three: Group[];
  blank: Group[];
  checking: Group[];
}

function loadProbe() {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--import', resolve(here, 'form-engine-register.mjs'),
    resolve(here, 'repeating-vaccine-submission.probe.mjs'),
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `probe exited ${result.status}`);
  }
  return JSON.parse(result.stdout) as Probe;
}

const probe = loadProbe();

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
const configured = resolveTokens(
  frontendConfig['@liberiaemr/esm-liberia-patient-chart-extension'].routineImmunizations,
  properties,
) as SequenceIdentityConfig;

const transientIds = ['td_gate', 'pediatric_pfizer_gate', 'pediatric_pfizer_status'];

function clinicalId(id: string) {
  return id.replace(/_\d+$/, '');
}

function conceptless(groups: Group[]) {
  return groups.flatMap((group) => group.groupMembers.filter((member) => member.valuePresent && member.conceptMissing));
}

function assertClinicalGroup(group: Group, expected: Record<string, string>) {
  assert.equal(group.concept, probe.concepts.group);
  assert.equal(group.hasUuid, false);
  assert.equal(group.hasVoided, false);
  assert.deepEqual(group.groupMembers.map((member) => clinicalId(member.id)), Object.keys(expected));
  for (const member of group.groupMembers) {
    assert.equal(member.transient, false);
    assert.equal(transientIds.includes(clinicalId(member.id)), false);
    assert.equal(member.conceptMissing, false);
    assert.equal(member.hasUuid, false);
    assert.equal(member.hasVoided, false);
    assert.equal(member.value, expected[clinicalId(member.id)]);
    const concept = clinicalId(member.id) === 'vaccine_name'
      ? probe.concepts.vaccine
      : clinicalId(member.id) === 'route'
        ? probe.concepts.route
        : probe.concepts.returnDate;
    assert.equal(member.concept, concept);
    assert.equal(member.groupParent, group.id);
  }
}

function nameUuid(seed: string) {
  const digest = createHash('md5').update(seed).digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function savedEncounter(groups: Group[], formUuid = properties.get('var.form.immunization.uuid')): NationalEncounter {
  const obs: NationalObs[] = groups.map((group) => ({
    uuid: group.id,
    concept: { uuid: group.concept ?? undefined },
    groupMembers: group.groupMembers.map((member) => ({
      uuid: member.id,
      concept: { uuid: member.concept ?? undefined },
      value: clinicalId(member.id) === 'return_date' ? member.value : { uuid: member.value ?? undefined },
    })),
  }));
  return {
    uuid: 'birth-visit',
    patient: { uuid: 'patient' },
    form: { uuid: formUuid },
    encounterDatetime: '2026-10-26T10:00:00.000Z',
    obs,
  };
}

describe('immunization repeating save payload', () => {
  it('keeps form v1.11 and the pinned form engine', () => {
    assert.equal(probe.version, '4.2.2-pre.2449');
    assert.equal(probe.formVersion, '1.11');
    const current = nameUuid('794c4598-ab82-47ca-8d18-483a8abe6f4f_Immunization_1.11');
    const frozenV19 = '03bb283b-fa68-3b2e-a97c-b8adf72d4a76';
    assert.equal(nameUuid('794c4598-ab82-47ca-8d18-483a8abe6f4f_Immunization_1.9'), frozenV19);
    assert.equal(properties.get('var.form.immunization.uuid'), current);
    assert.equal(properties.get('var.form.immunization.v1-9.uuid'), frozenV19);
    assert.equal(configured.nationalFormUuids.includes(frozenV19), true);
    assert.equal(configured.nationalFormUuids.includes(current), true);
    for (const id of transientIds) {
      assert.equal(probe.comparison[id].type, 'control');
      assert.equal(probe.comparison[id].transient, true);
      assert.equal(probe.comparison[id].concept, null);
      assert.equal(probe.comparison[`${id}_1`].type, 'control');
      assert.equal(probe.comparison[`${id}_1`].concept, null);
    }
    assert.equal(probe.comparison.vaccine_name.type, 'obs');
    assert.equal(probe.comparison.vaccine_name_1.concept, probe.concepts.vaccine);
    assert.equal(probe.comparison.route_1.concept, probe.concepts.route);
    assert.equal(probe.comparison.return_date_1.concept, probe.concepts.returnDate);
    assert.equal(probe.comparison.td_gate.sharedWithGroupQuestions, false);
    assert.equal(probe.comparison.td_gate_1.sharedWithGroupQuestions, true);
  });

  it('saves one vaccine group with a concept on every populated child', () => {
    assert.equal(probe.single.length, 1);
    assertClinicalGroup(probe.single[0], {
      vaccine_name: probe.concepts.bcg,
      route: probe.concepts.oral,
      return_date: '2026-11-02',
    });
    assert.deepEqual(conceptless(probe.single), []);
  });

  it('saves two vaccine groups without crossing values or leaking transient obs', () => {
    assert.equal(probe.two.length, 2);
    assert.notEqual(probe.two[0].id, probe.two[1].id);
    assertClinicalGroup(probe.two[0], {
      vaccine_name: probe.concepts.bcg,
      route: probe.concepts.oral,
      return_date: '2026-11-02',
    });
    assertClinicalGroup(probe.two[1], {
      vaccine_name: probe.concepts.opv1,
      route: probe.concepts.oral,
      return_date: '2026-12-01',
    });
    assert.deepEqual(conceptless(probe.two), []);
    assert.deepEqual(conceptless(probe.checking), []);
    const checkingValues = probe.checking.flatMap((group) => group.groupMembers.map((member) => member.value));
    assert.equal(checkingValues.includes('allowed'), false);
    assert.equal(checkingValues.includes('Checking immunization history…'), false);
  });

  it('omits a blank route and return date instead of posting a partial obs', () => {
    assert.equal(probe.blank.length, 2);
    assertClinicalGroup(probe.blank[0], {
      vaccine_name: probe.concepts.bcg,
      route: probe.concepts.oral,
      return_date: '2026-11-02',
    });
    assertClinicalGroup(probe.blank[1], {
      vaccine_name: probe.concepts.opv1,
    });
    assert.deepEqual(conceptless(probe.blank), []);
  });

  it('saves a third cloned row on its own group', () => {
    assert.equal(probe.three.length, 3);
    assertClinicalGroup(probe.three[2], {
      vaccine_name: probe.concepts.opv0,
      route: probe.concepts.oral,
      return_date: '2027-01-04',
    });
    assert.deepEqual(conceptless(probe.three), []);
  });

  it('shows both vaccines from the saved encounter without collapsing them', () => {
    for (const formUuid of [
      properties.get('var.form.immunization.v1-9.uuid'),
      properties.get('var.form.immunization.uuid'),
    ]) {
      const encounter = savedEncounter(probe.two, formUuid);
      const history = normalizeHistory({
        patientUuid: 'patient',
        fhir: [],
        encounters: [encounter],
        nationalFormUuids: configured.nationalFormUuids,
        vaccineQuestionUuid: configured.vaccineQuestionUuid,
        vaccineConceptUuids: configured.vaccineConceptUuids,
      });
      assert.deepEqual(history.issues, []);
      assert.deepEqual(history.doses.map((dose) => [dose.canonicalDoseId, dose.records.map((record) => record.recordId)]), [
        ['BCG', ['national-form:vaccine_name']],
        ['OPV1', ['national-form:vaccine_name_1']],
      ]);
      const rows = administeredTimeline({
        patientUuid: 'patient',
        fhir: [],
        encounters: [encounter],
        config: configured,
      });
      assert.equal(rows.unresolved, false);
      const shown = rows.entries.filter((entry) => entry.canonicalDoseId === 'BCG' || entry.canonicalDoseId === 'OPV1');
      assert.deepEqual(shown.map((entry) => [
        entry.canonicalDoseId,
        entry.routeConceptUuid,
        entry.returnDate,
        entry.recordIds,
      ]), [
        ['BCG', probe.concepts.oral, '2026-11-02', ['national-form:vaccine_name']],
        ['OPV1', probe.concepts.oral, '2026-12-01', ['national-form:vaccine_name_1']],
      ]);
      assert.equal(encounter.uuid, 'birth-visit');
      assert.equal(encounter.form?.uuid, formUuid);
    }
  });
});
