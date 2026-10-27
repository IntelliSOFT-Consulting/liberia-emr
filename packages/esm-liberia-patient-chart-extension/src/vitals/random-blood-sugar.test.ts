import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keepHistoryEncounter } from '../liberia-obs-widget/keep-history-encounter.ts';
import { buildRbsEncounter, rbsConceptPair, validateRbsValue } from './random-blood-sugar.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MG = '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MMOL = '1458AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FASTING = '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const concepts = { mgDl: MG, mmol: MMOL };

describe('blood sugar encounter', () => {
  const base = {
    patientUuid: 'patient',
    encounterTypeUuid: 'vitals-encounter',
    locationUuid: 'clinic',
    visitUuid: 'visit',
    concepts,
  };

  it('saves mg/dL as one CIEL 887 observation', () => {
    const encounter = buildRbsEncounter({ ...base, unit: 'mg/dL', raw: '105' });
    assert.deepEqual(encounter?.obs, [{ concept: MG, value: 105 }]);
    assert.equal(encounter?.encounterType, 'vitals-encounter');
    assert.equal(encounter?.visit, 'visit');
    assert.equal(JSON.stringify(encounter).includes(MMOL), false);
    assert.equal(JSON.stringify(encounter).includes(FASTING), false);
  });

  it('saves mmol/L as one CIEL 1458 observation', () => {
    const encounter = buildRbsEncounter({ ...base, unit: 'mmol/L', raw: '5.8' });
    assert.deepEqual(encounter?.obs, [{ concept: MMOL, value: 5.8 }]);
    assert.equal(JSON.stringify(encounter).includes(MG), false);
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
