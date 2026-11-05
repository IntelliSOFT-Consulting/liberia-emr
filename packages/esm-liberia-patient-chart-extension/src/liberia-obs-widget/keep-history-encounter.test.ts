import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keepHistoryEncounter, summarizeObsDisplays } from './keep-history-encounter.ts';

const immunization = 'immunization-form';
const aefi = 'aefi-form';
const consultation = 'consultation-form';
const dedicated = 'immunizations-type';

describe('keepHistoryEncounter', () => {
  it('keeps every encounter when no form or dedicated type is configured', () => {
    assert.equal(keepHistoryEncounter({ form: { uuid: consultation } }, [], []), true);
  });

  it('keeps immunization and AEFI forms and the dedicated type', () => {
    const forms = [immunization, aefi];
    const types = [dedicated];
    assert.equal(keepHistoryEncounter({ form: { uuid: immunization }, encounterType: { uuid: 'consultation' } }, forms, types), true);
    assert.equal(keepHistoryEncounter({ form: { uuid: aefi }, encounterType: { uuid: 'consultation' } }, forms, types), true);
    assert.equal(keepHistoryEncounter({ encounterType: { uuid: dedicated } }, forms, types), true);
  });

  it('drops a consultation encounter that is not an immunization form', () => {
    assert.equal(
      keepHistoryEncounter(
        { form: { uuid: consultation }, encounterType: { uuid: 'consultation' } },
        [immunization, aefi],
        [dedicated],
      ),
      false,
    );
  });
});

describe('summarizeObsDisplays', () => {
  it('joins observation displays and leaves an empty row blank', () => {
    assert.equal(summarizeObsDisplays([{ display: 'BCG' }, { display: 'Left arm' }]), 'BCG; Left arm');
    assert.equal(summarizeObsDisplays([]), '--');
  });
});
