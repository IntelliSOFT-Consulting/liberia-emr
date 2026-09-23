import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAncInitialEncounter,
  isAncSourceEncounter,
  isDeliveryEncounter,
  isNationalAncFormEncounter,
  parseNumericObsValue,
  previousDeliveryTimeBefore,
  selectLatestAncNumeric,
  type EpisodeEncounter,
  type LabourEpisodeConfig,
} from './labour-episode.ts';

const GRAVIDA = 'gravida-uuid';
const PARITY = 'parity-uuid';
const ANC_INITIAL_TYPE = 'anc-initial-type';
const ANC_INITIAL_FORM = 'anc-initial-form';
const DELIVERY_TYPE = 'delivery-type';
const THIRD_STAGE_FORM = 'third-stage-form';

const config: LabourEpisodeConfig = {
  deliveryEncounterTypeUuid: DELIVERY_TYPE,
  thirdStageFormUuid: THIRD_STAGE_FORM,
  ancInitialEncounterTypeUuid: ANC_INITIAL_TYPE,
  ancInitialFormUuid: ANC_INITIAL_FORM,
  ancNationalFormName: '1. ANC Form',
};

function enc(opts: {
  datetime: string;
  type?: string;
  formUuid?: string;
  formName?: string;
  gravida?: number;
  parity?: number;
}): EpisodeEncounter {
  const obs = [];
  if (opts.gravida !== undefined) {
    obs.push({ concept: { uuid: GRAVIDA }, value: opts.gravida });
  }
  if (opts.parity !== undefined) {
    obs.push({ concept: { uuid: PARITY }, value: opts.parity });
  }
  return {
    uuid: `${opts.datetime}-${opts.formName ?? opts.type ?? 'enc'}`,
    encounterDatetime: opts.datetime,
    encounterType: opts.type ? { uuid: opts.type } : undefined,
    form: opts.formName || opts.formUuid ? { uuid: opts.formUuid, name: opts.formName } : undefined,
    obs,
  };
}

const asOf = new Date('2026-09-21T12:00:00.000Z');

describe('ANC source identity', () => {
  it('recognises ANC Initial by encounter type, form UUID, or form name', () => {
    assert.equal(isAncInitialEncounter(enc({ datetime: asOf.toISOString(), type: ANC_INITIAL_TYPE }), config), true);
    assert.equal(
      isAncInitialEncounter(enc({ datetime: asOf.toISOString(), formUuid: ANC_INITIAL_FORM }), config),
      true,
    );
    assert.equal(
      isAncInitialEncounter(enc({ datetime: asOf.toISOString(), formName: 'ANC Initial Visit' }), config),
      true,
    );
  });

  it('recognises the legacy national form by name only', () => {
    assert.equal(
      isNationalAncFormEncounter(
        enc({ datetime: asOf.toISOString(), formName: '1. ANC Form', type: 'consultation' }),
        config,
      ),
      true,
    );
    assert.equal(
      isAncSourceEncounter(
        enc({ datetime: asOf.toISOString(), type: 'consultation', formName: 'OPD Consultation' }),
        config,
      ),
      false,
    );
  });

  it('does not treat L&D, PNC or FP encounters as ANC sources', () => {
    assert.equal(
      isAncSourceEncounter(
        enc({ datetime: asOf.toISOString(), formName: '1. First and Second Stage of Labor and Delivery', gravida: 4 }),
        config,
      ),
      false,
    );
    assert.equal(
      isAncSourceEncounter(enc({ datetime: asOf.toISOString(), formName: 'Postnatal Visit', parity: 2 }), config),
      false,
    );
    assert.equal(
      isAncSourceEncounter(enc({ datetime: asOf.toISOString(), formName: '3. Family Planning', gravida: 9 }), config),
      false,
    );
  });
});

describe('delivery episode boundary', () => {
  it('covers every current delivery-identity signal, including the implemented form-name fallback', () => {
    assert.equal(isDeliveryEncounter(enc({ datetime: asOf.toISOString(), type: DELIVERY_TYPE }), config), true);
    assert.equal(isDeliveryEncounter(enc({ datetime: asOf.toISOString(), formUuid: THIRD_STAGE_FORM }), config), true);
    assert.equal(
      isDeliveryEncounter(
        enc({ datetime: asOf.toISOString(), formName: '3. Third Stage of Labor and Delivery' }),
        config,
      ),
      true,
    );
    assert.equal(isDeliveryEncounter(enc({ datetime: asOf.toISOString(), formName: 'Delivery Summary' }), config), true);
    assert.equal(
      isDeliveryEncounter(
        enc({ datetime: asOf.toISOString(), formName: '1. First and Second Stage of Labor and Delivery' }),
        config,
      ),
      false,
    );
  });

  it('uses the latest delivery before asOf as the exclusive episode start', () => {
    const encounters = [
      enc({ datetime: '2024-01-01T00:00:00.000Z', type: DELIVERY_TYPE }),
      enc({ datetime: '2025-06-01T00:00:00.000Z', type: DELIVERY_TYPE }),
      enc({ datetime: '2026-09-21T18:00:00.000Z', type: DELIVERY_TYPE }),
    ];
    assert.equal(
      previousDeliveryTimeBefore(encounters, config, asOf.getTime()),
      new Date('2025-06-01T00:00:00.000Z').getTime(),
    );
  });
});

describe('selectLatestAncNumeric', () => {
  it('prefills Gravida 3 and Parity 2 from current ANC Initial', () => {
    const encounters = [enc({ datetime: '2026-08-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 3, parity: 2 })];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), 3);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), 2);
  });

  it('prefills only Gravida when Parity is missing', () => {
    const encounters = [enc({ datetime: '2026-08-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 2 })];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), 2);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), null);
  });

  it('leaves both blank when there is no ANC data', () => {
    const encounters = [
      enc({ datetime: '2026-08-01T00:00:00.000Z', formName: '3. Family Planning', gravida: 5, parity: 4 }),
    ];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), null);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), null);
  });

  it('does not carry previous-pregnancy ANC into a later pregnancy', () => {
    const encounters = [
      enc({ datetime: '2024-03-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 2, parity: 1 }),
      enc({ datetime: '2024-09-01T00:00:00.000Z', type: DELIVERY_TYPE }),
    ];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), null);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), null);
  });

  it('uses current-pregnancy ANC after a previous delivery', () => {
    const encounters = [
      enc({ datetime: '2024-03-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 2, parity: 1 }),
      enc({ datetime: '2024-09-01T00:00:00.000Z', type: DELIVERY_TYPE }),
      enc({ datetime: '2026-07-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 3, parity: 2 }),
    ];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), 3);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), 2);
  });

  it('prefers ANC Initial over the legacy national form when both exist', () => {
    const encounters = [
      enc({ datetime: '2026-08-15T00:00:00.000Z', formName: '1. ANC Form', gravida: 9 }),
      enc({ datetime: '2026-08-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 3, parity: 2 }),
    ];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), 3);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), 2);
  });

  it('falls back to 1. ANC Form Gravida when there is no ANC Initial', () => {
    const encounters = [enc({ datetime: '2026-08-01T00:00:00.000Z', formName: '1. ANC Form', gravida: 4 })];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), 4);
    assert.equal(selectLatestAncNumeric(encounters, PARITY, config, asOf), null);
  });

  it('ignores ANC recorded at or after the current L&D as-of time', () => {
    const encounters = [enc({ datetime: '2026-09-21T12:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 3, parity: 2 })];
    assert.equal(selectLatestAncNumeric(encounters, GRAVIDA, config, asOf), null);
  });

  it('parses numeric obs stored as strings and treats 0 as a real Parity value', () => {
    assert.equal(parseNumericObsValue({ value: '0' }), 0);
    assert.equal(
      selectLatestAncNumeric(
        [enc({ datetime: '2026-08-01T00:00:00.000Z', type: ANC_INITIAL_TYPE, gravida: 1, parity: 0 })],
        PARITY,
        config,
        asOf,
      ),
      0,
    );
  });
});

describe('Parity cannot be greater than Gravida', () => {
  const isEmpty = (value: unknown) => value === undefined || value === null || value === '';
  const failsWhen = (myValue: unknown, gravida: unknown) =>
    !isEmpty(myValue) && !isEmpty(gravida) && Number(myValue) > Number(gravida);

  it('still flags a prefilled G2/P10 pairing', () => {
    assert.equal(failsWhen(10, 2), true);
  });

  it('accepts a consistent G3/P2 pairing', () => {
    assert.equal(failsWhen(2, 3), false);
  });
});
