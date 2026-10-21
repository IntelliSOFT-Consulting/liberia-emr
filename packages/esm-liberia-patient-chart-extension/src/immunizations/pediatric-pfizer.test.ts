import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { FhirImmunization, NationalEncounter } from './history.ts';
import { sequenceHistoryUrls } from './load-history.ts';
import { evaluateSequence } from './sequence.ts';
import { ruleById } from './sequence-rules.ts';
import type { SequenceIdentityConfig } from './routine-config.ts';
import {
  evaluatePediatricPfizerAdministration,
  historyBelongsToPatient,
  pediatricPfizerStatusLabel,
  type PediatricPfizerGateCode,
} from './pediatric-pfizer.ts';

const moduleName = '@liberiaemr/esm-liberia-patient-chart-extension';
const birth = '2014-01-01';
const dose1Date = '2025-12-20';
const day27 = '2026-01-16';
const day28 = '2026-01-17';
const day29 = '2026-01-18';
const fhirBaseUrl = 'http://openmrs.local/ws/fhir2/R4';
const restBaseUrl = 'http://openmrs.local/ws/rest/v1';

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

const dose1Concept = national.vaccineConceptUuids.PediatricPfizer1;
const dose2Concept = national.vaccineConceptUuids.PediatricPfizer2;

function fhir(conceptUuid: string, date: string, id: string, patient = 'patient-1', status = 'completed'): FhirImmunization {
  return {
    resourceType: 'Immunization', id, status,
    patient: { reference: `Patient/${patient}` },
    vaccineCode: { coding: [{ code: conceptUuid }] },
    occurrenceDateTime: date,
  };
}

function encounter(
  conceptUuid: string, date: string, id: string, patient = 'patient-1',
  formUuid = national.nationalFormUuids.at(-1)!,
): NationalEncounter {
  return {
    uuid: `enc-${id}`, patient: { uuid: patient }, form: { uuid: formUuid }, encounterDatetime: date,
    obs: [{ uuid: id, concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: conceptUuid } }],
  };
}

function bundle(records: FhirImmunization[]) {
  return {
    resourceType: 'Bundle', type: 'searchset', total: records.length,
    entry: records.map((resource) => ({ resource })),
  };
}

function gate(input: {
  patientUuid?: string;
  birthDate?: string;
  evaluationDate: string;
  vaccineConceptUuid: string;
  fhir?: FhirImmunization[];
  encounters?: NationalEncounter[];
  editingEncounterUuid?: string;
  dose1ConceptUuid?: string;
  dose2ConceptUuid?: string;
  config?: SequenceIdentityConfig;
  fetchPage?: (url: string) => Promise<unknown>;
}) {
  const fhirRecords = input.fhir ?? [];
  const encounters = input.encounters ?? [];
  const calls: string[] = [];
  return {
    calls,
    result: evaluatePediatricPfizerAdministration({
      patientUuid: input.patientUuid ?? 'patient-1',
      birthDate: input.birthDate ?? birth,
      evaluationDate: input.evaluationDate,
      vaccineConceptUuid: input.vaccineConceptUuid,
      dose1ConceptUuid: input.dose1ConceptUuid ?? dose1Concept,
      dose2ConceptUuid: input.dose2ConceptUuid ?? dose2Concept,
      editingEncounterUuid: input.editingEncounterUuid,
      config: input.config ?? national,
      fhirBaseUrl,
      restBaseUrl,
      fetchPage: input.fetchPage ?? (async (url) => {
        calls.push(url);
        if (url.includes('/Immunization')) return bundle(fhirRecords);
        return { results: encounters };
      }),
    }),
  };
}

async function code(input: Parameters<typeof gate>[0]): Promise<PediatricPfizerGateCode> {
  return (await gate(input).result);
}

describe('Pediatric Pfizer save decision', () => {
  const schedule = JSON.parse(readFileSync(new URL('./routine-schedule.json', import.meta.url), 'utf8')) as Array<{ id: string }>;

  it('keeps Pediatric Pfizer off the under-2 routine schedule', () => {
    assert.equal(schedule.some((dose) => dose.id === 'PediatricPfizer1' || dose.id === 'PediatricPfizer2'), false);
    assert.equal(ruleById('PediatricPfizer2')?.upperAge, undefined);
  });

  it('blocks dose 1 outside the 5th birthday through the day before the 12th', async () => {
    assert.equal(await code({ evaluationDate: '2018-12-31', vaccineConceptUuid: dose1Concept }), 'not-yet-due');
    assert.equal(await code({ evaluationDate: '2019-01-01', vaccineConceptUuid: dose1Concept }), 'due');
    assert.equal(await code({ evaluationDate: '2025-12-31', vaccineConceptUuid: dose1Concept }), 'due');
    assert.equal(await code({ evaluationDate: '2026-01-01', vaccineConceptUuid: dose1Concept }), 'not-eligible');
  });

  it('blocks dose 2 without dose 1, before day 28, and when either dose is already recorded', async () => {
    const first = [fhir(dose1Concept, dose1Date, 'pfizer1')];
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept }), 'waiting-for-prerequisite');
    assert.equal(await code({ evaluationDate: day27, vaccineConceptUuid: dose2Concept, fhir: first }), 'waiting-for-interval');
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept, fhir: first }), 'due');
    assert.equal(await code({ evaluationDate: day29, vaccineConceptUuid: dose2Concept, fhir: first }), 'overdue');
    assert.equal(await code({ evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept, fhir: first }), 'already-given');
    assert.equal(await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept,
      fhir: [...first, fhir(dose2Concept, day29, 'pfizer2')],
    }), 'already-given');
  });

  it('allows dose 2 on day 28 after the 12th birthday', async () => {
    const result = evaluateSequence({
      patientUuid: 'patient-1', doseId: 'PediatricPfizer2', birthDate: birth, evaluationDate: day28,
      fhir: [fhir(dose1Concept, dose1Date, 'pfizer1')], encounters: [], config: national,
    });
    assert.equal(result.status, 'DUE');
    assert.equal(result.canAdminister, true);
    assert.equal(result.eligibleDate, day28);
    assert.equal(await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept, fhir: [fhir(dose1Concept, dose1Date, 'pfizer1')],
    }), 'due');
    assert.equal(pediatricPfizerStatusLabel('due'), 'Due');
    assert.equal(pediatricPfizerStatusLabel('overdue'), 'Overdue');
  });

  it('counts a national-form dose 1 and a completed FHIR dose 1, and ignores AEFI', async () => {
    const nationalDose = encounter(dose1Concept, dose1Date, 'form-dose-1');
    const completed = fhir(dose1Concept, dose1Date, 'fhir-dose-1');
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept, encounters: [nationalDose] }), 'due');
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept, fhir: [completed] }), 'due');
    const notDone = fhir(dose1Concept, dose1Date, 'not-done', 'patient-1', 'not-done');
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept, fhir: [notDone] }), 'waiting-for-prerequisite');
    const aefi: NationalEncounter = {
      uuid: 'aefi-enc', patient: { uuid: 'patient-1' }, form: { uuid: properties.get('var.form.aefi.uuid') },
      encounterDatetime: dose1Date,
      obs: [{
        uuid: 'aefi-pfizer', concept: { uuid: properties.get('var.concept.national.aefi-vaccine.uuid') },
        value: { uuid: dose1Concept },
      }],
    };
    assert.equal(await code({ evaluationDate: day28, vaccineConceptUuid: dose2Concept, encounters: [aefi] }), 'waiting-for-prerequisite');
  });

  it('collapses the same dose on the same date and fails closed on conflicting dates', async () => {
    const sameDay = await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept,
      fhir: [fhir(dose1Concept, dose1Date, 'fhir-dose-1')],
      encounters: [encounter(dose1Concept, dose1Date, 'form-dose-1')],
    });
    assert.equal(sameDay, 'due');
    const conflict = await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept,
      fhir: [fhir(dose1Concept, dose1Date, 'fhir-dose-1')],
      encounters: [encounter(dose1Concept, '2025-12-21', 'form-dose-1')],
    });
    assert.equal(conflict, 'unresolved');
  });

  it('recognizes a saved national dose on the next history read', async () => {
    const saved = encounter(dose1Concept, dose1Date, 'saved-dose-1');
    let encounters: NationalEncounter[] = [];
    const before = await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async (url) => url.includes('/Immunization') ? bundle([]) : { results: encounters },
    });
    assert.equal(before, 'due');
    encounters = [saved];
    const after = await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async (url) => url.includes('/Immunization') ? bundle([]) : { results: encounters },
    });
    assert.equal(after, 'already-given');
    const followUp = await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept,
      fetchPage: async (url) => url.includes('/Immunization') ? bundle([]) : { results: encounters },
    });
    assert.equal(followUp, 'due');
  });

  it('keeps dose 1 when a sibling vaccine in the encounter being edited is not dose 1', async () => {
    const current: NationalEncounter = {
      uuid: 'enc-editing', patient: { uuid: 'patient-1' }, form: { uuid: national.nationalFormUuids.at(-1)! },
      encounterDatetime: dose1Date,
      obs: [
        {
          uuid: 'group-pfizer', concept: { uuid: 'vaccine-administration' },
          groupMembers: [{ uuid: 'pfizer-obs', concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: dose1Concept } }],
        },
        {
          uuid: 'group-bcg', concept: { uuid: 'vaccine-administration' },
          groupMembers: [{ uuid: 'bcg-obs', concept: { uuid: national.vaccineQuestionUuid }, value: { uuid: national.vaccineConceptUuids.BCG } }],
        },
      ],
    };
    assert.equal(await code({
      evaluationDate: day28, vaccineConceptUuid: dose2Concept, encounters: [current], editingEncounterUuid: current.uuid,
    }), 'due');
    assert.equal(await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept, encounters: [current], editingEncounterUuid: current.uuid,
    }), 'due');
  });

  it('excludes only the encounter being edited', async () => {
    const current = encounter(dose1Concept, dose1Date, 'editing');
    const other = encounter(dose1Concept, '2025-12-19', 'other');
    assert.equal(await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept, encounters: [current], editingEncounterUuid: current.uuid,
    }), 'due');
    assert.equal(await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept, encounters: [current, other], editingEncounterUuid: current.uuid,
    }), 'already-given');
    assert.equal(await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept, encounters: [current, other],
    }), 'unresolved');
  });

  it('loads history for the active patient and does not reuse another patient', async () => {
    const urls = sequenceHistoryUrls('patient-a', fhirBaseUrl, restBaseUrl);
    assert.equal(new URL(urls.fhirUrl).searchParams.get('patient'), 'patient-a');
    assert.equal(new URL(urls.encounterUrl).searchParams.get('patient'), 'patient-a');
    const seen: string[] = [];
    const first = gate({
      patientUuid: 'patient-a', evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async (url) => {
        seen.push(url);
        const patient = new URL(url).searchParams.get('patient');
        if (url.includes('/Immunization')) return bundle([fhir(dose1Concept, dose1Date, 'a-dose', 'patient-a')]);
        return { results: [encounter(dose1Concept, dose1Date, 'a-form', patient ?? 'patient-a')] };
      },
    });
    assert.equal(await first.result, 'already-given');
    const firstUrls = seen.slice();
    assert.ok(firstUrls.length >= 2);
    assert.ok(firstUrls.every((url) => new URL(url).searchParams.get('patient') === 'patient-a'));
    const second = gate({
      patientUuid: 'patient-b', evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async (url) => {
        seen.push(url);
        if (url.includes('/Immunization')) return bundle([]);
        return { results: [] };
      },
    });
    assert.equal(await second.result, 'due');
    const secondUrls = seen.slice(firstUrls.length);
    assert.ok(secondUrls.length >= 2);
    assert.ok(secondUrls.every((url) => new URL(url).searchParams.get('patient') === 'patient-b'));
  });

  it('fails closed when history belongs to someone else or the page changes patient', async () => {
    assert.equal(historyBelongsToPatient('patient-a', [fhir(dose1Concept, dose1Date, 'other', 'patient-b')], []), false);
    assert.equal(await code({
      patientUuid: 'patient-a', evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fhir: [fhir(dose1Concept, dose1Date, 'other', 'patient-b')],
    }), 'unresolved');
    assert.equal(await code({
      patientUuid: 'patient-a', evaluationDate: '2019-01-01', vaccineConceptUuid: dose1Concept,
      fetchPage: async (url) => {
        if (!url.includes('/Immunization')) return { results: [] };
        if (url.includes('patient-b')) return bundle([]);
        return {
          resourceType: 'Bundle', type: 'searchset', total: 0, entry: [],
          link: [{ relation: 'next', url: `${fhirBaseUrl}/Immunization?patient=patient-b` }],
        };
      },
    }), 'unresolved');
    const skipped = gate({
      patientUuid: '', evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async () => { throw new Error('should not fetch'); },
    });
    assert.equal(await skipped.result, 'unresolved');
    assert.deepEqual(skipped.calls, []);
    assert.equal(await code({
      evaluationDate: dose1Date, vaccineConceptUuid: dose1Concept,
      fetchPage: async () => { throw new Error('history down'); },
    }), 'unresolved');
    assert.equal(await code({ evaluationDate: '2019-01-01', vaccineConceptUuid: national.vaccineConceptUuids.BCG }), 'allowed');
  });
});
