import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keepHistoryEncounter } from '../liberia-obs-widget/keep-history-encounter.ts';
import {
  buildRbsEncounter,
  clinicianEncounterRole,
  formatOpenmrsEncounterDatetime,
  rbsConceptPair,
  rbsEncounterMetadataError,
  validateRbsValue,
} from './random-blood-sugar.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MG = '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MMOL = '1458AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FASTING = '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const concepts = { mgDl: MG, mmol: MMOL };

function offsetSuffix(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const minutes = String(absoluteOffset % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

describe('blood sugar encounter', () => {
  const recordedAt = new Date(2026, 9, 28, 11, 4, 5, 6);
  const base = {
    patientUuid: 'patient',
    encounterTypeUuid: 'vitals-encounter',
    locationUuid: 'clinic',
    visitUuid: 'visit',
    providerUuid: 'current-provider',
    encounterRoleUuid: 'clinician-role',
    encounterDatetime: recordedAt,
    concepts,
  };

  it('saves mg/dL as one CIEL 887 observation', () => {
    const encounter = buildRbsEncounter({ ...base, unit: 'mg/dL', raw: '105' });
    assert.equal(encounter?.patient, 'patient');
    assert.equal(encounter?.encounterType, 'vitals-encounter');
    assert.equal(encounter?.location, 'clinic');
    assert.equal(encounter?.visit, 'visit');
    assert.equal(encounter?.encounterDatetime, '2026-10-28T11:04:05.006' + offsetSuffix(recordedAt));
    assert.equal(encounter?.encounterDatetime, formatOpenmrsEncounterDatetime(recordedAt));
    assert.deepEqual(encounter?.encounterProviders, [
      { provider: 'current-provider', encounterRole: 'clinician-role' },
    ]);
    assert.equal(Object.hasOwn(encounter ?? {}, 'provider'), false);
    assert.deepEqual(encounter?.obs, [{ concept: MG, value: 105 }]);
    assert.equal(encounter?.obs.length, 1);
    assert.equal(JSON.stringify(encounter).includes(MMOL), false);
    assert.equal(JSON.stringify(encounter).includes(FASTING), false);
  });

  it('saves mmol/L as one CIEL 1458 observation', () => {
    const encounter = buildRbsEncounter({ ...base, unit: 'mmol/L', raw: '5.8' });
    assert.equal(encounter?.patient, 'patient');
    assert.equal(encounter?.encounterType, 'vitals-encounter');
    assert.equal(encounter?.location, 'clinic');
    assert.equal(encounter?.visit, 'visit');
    assert.equal(encounter?.encounterDatetime, formatOpenmrsEncounterDatetime(recordedAt));
    assert.deepEqual(encounter?.encounterProviders, [
      { provider: 'current-provider', encounterRole: 'clinician-role' },
    ]);
    assert.deepEqual(encounter?.obs, [{ concept: MMOL, value: 5.8 }]);
    assert.equal(encounter?.obs.length, 1);
    assert.equal(JSON.stringify(encounter).includes(MG), false);
  });

  it('omits the visit when the patient has none', () => {
    const encounter = buildRbsEncounter({ ...base, visitUuid: undefined, unit: 'mg/dL', raw: '105' });
    assert.equal(Object.hasOwn(encounter ?? {}, 'visit'), false);
    assert.equal(encounter?.encounterProviders.length, 1);
  });

  it('refuses to build an encounter when provider, role, or time is missing', () => {
    assert.equal(buildRbsEncounter({ ...base, providerUuid: undefined, unit: 'mg/dL', raw: '105' }), null);
    assert.equal(buildRbsEncounter({ ...base, providerUuid: '', unit: 'mmol/L', raw: '5.8' }), null);
    assert.equal(buildRbsEncounter({ ...base, encounterRoleUuid: null, unit: 'mg/dL', raw: '105' }), null);
    assert.equal(buildRbsEncounter({ ...base, encounterDatetime: new Date(Number.NaN), unit: 'mg/dL', raw: '90' }), null);
    assert.equal(buildRbsEncounter({ ...base, locationUuid: undefined, unit: 'mg/dL', raw: '90' }), null);
    assert.equal(
      rbsEncounterMetadataError({
        patientUuid: 'patient',
        encounterTypeUuid: 'vitals-encounter',
        locationUuid: 'clinic',
        encounterDatetime: recordedAt,
      }),
      'The logged-in user has no provider.',
    );
    assert.equal(
      rbsEncounterMetadataError({
        patientUuid: 'patient',
        encounterTypeUuid: 'vitals-encounter',
        locationUuid: 'clinic',
        providerUuid: 'current-provider',
        encounterRoleUuid: null,
        encounterDatetime: recordedAt,
      }),
      'No encounter role is available.',
    );
    assert.equal(clinicianEncounterRole([{ uuid: 'other', name: 'Unknown' }, { uuid: 'clinician-role', name: 'Clinician' }]), 'clinician-role');
    assert.equal(clinicianEncounterRole([]), null);
  });

  it('does not convert 105 mg/dL into an mmol/L observation', () => {
    assert.equal(buildRbsEncounter({ ...base, unit: 'mmol/L', raw: '105' }), null);
    assert.equal(validateRbsValue('mmol/L', '105'), 'Initial blood sugar must be between 0 and 33.3 mmol/L.');
    assert.equal(validateRbsValue('mg/dL', '105.5'), 'Initial blood sugar in mg/dL must be a whole number.');
    assert.equal(validateRbsValue('mg/dL', '601'), 'Initial blood sugar must be between 0 and 600 mg/dL.');
    assert.equal(validateRbsValue('mmol/L', '33.4'), 'Initial blood sugar must be between 0 and 33.3 mmol/L.');
    assert.equal(buildRbsEncounter({ ...base, unit: 'mg/dL', raw: '' }), null);
  });

  it('reads the unit pair from the history column', () => {
    assert.deepEqual(
      rbsConceptPair([
        {
          concepts: [
            { concept: MG, unit: 'mg/dL' },
            { concept: MMOL, unit: 'mmol/L' },
          ],
        },
      ]),
      concepts,
    );
  });
});

describe('blood sugar is visible with Triage and OPD history', () => {
  it('keeps a formless vitals encounter and the existing Triage and OPD forms', () => {
    const config = JSON.parse(
      readFileSync(
        join(root, 'content-packages/content-liberia-opd-ipd/configuration/frontend_configuration/config-opd.json'),
        'utf8',
      ),
    )['liberia-rbs-history'];
    assert.equal(config.entryWorkspace, 'liberia-rbs-workspace');
    assert.equal(config.entryEncounterType, '${var.encountertype.vitals.uuid}');
    assert.equal(config.encounterTypes.includes('${var.encountertype.vitals.uuid}'), true);
    assert.equal(config.dedicatedTypeUuids.includes('${var.encountertype.vitals.uuid}'), true);
    assert.equal(config.showAddButton, true);
    assert.equal(JSON.stringify(config).includes(FASTING), false);
    assert.equal(
      keepHistoryEncounter({ encounterType: { uuid: 'vitals' } }, config.formUuids, ['vitals']),
      true,
    );
    assert.equal(
      keepHistoryEncounter({ form: { uuid: 'anc-form' }, encounterType: { uuid: 'consultation' } }, config.formUuids, [
        'vitals',
      ]),
      false,
    );
  });
});
