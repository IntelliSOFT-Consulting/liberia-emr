import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { routineDoseNotYetDue } from './routine-dose-gate.ts';

const doseMap = 'BCG=bcg-uuid,OPV1=opv1-uuid,HPV1=hpv1-uuid';
const birth = '2026-01-01';

describe('routineDoseNotYetDue', () => {
  it('warns before the due age and not on or after it', () => {
    // OPV1 is due at 42 days: 2026-02-12.
    assert.equal(routineDoseNotYetDue(birth, '2026-02-11', 'opv1-uuid', doseMap), true);
    assert.equal(routineDoseNotYetDue(birth, '2026-02-12', 'opv1-uuid', doseMap), false);
    assert.equal(routineDoseNotYetDue(birth, '2026-03-01', 'opv1-uuid', doseMap), false);
  });

  it('never warns for birth doses, non-routine doses, or incomplete input', () => {
    assert.equal(routineDoseNotYetDue(birth, birth, 'bcg-uuid', doseMap), false);
    assert.equal(routineDoseNotYetDue(birth, '2026-01-02', 'hpv1-uuid', doseMap), false);
    assert.equal(routineDoseNotYetDue(birth, '2026-01-02', 'unknown-uuid', doseMap), false);
    assert.equal(routineDoseNotYetDue(undefined, '2026-01-02', 'opv1-uuid', doseMap), false);
    assert.equal(routineDoseNotYetDue(birth, '', 'opv1-uuid', doseMap), false);
  });

  it('accepts Date and timestamp inputs', () => {
    assert.equal(routineDoseNotYetDue(new Date(2026, 0, 1), '2026-01-20T10:00:00.000Z', 'opv1-uuid', doseMap), true);
  });

  it('is a warning on the vaccine field, not a blocking validator', () => {
    const form = readFileSync(new URL(
      '../../../../content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json',
      import.meta.url,
    ), 'utf8');
    const validators = JSON.parse(form).pages.flatMap((page: any) => page.sections)
      .flatMap((section: any) => section.questions)
      .flatMap(function all(question: any): any[] { return [question, ...(question.questions ?? []).flatMap(all)]; })
      .flatMap((question: any) => question.validators ?? [])
      .filter((validator: any) => JSON.stringify(validator).includes('routineDoseNotYetDue'));
    assert.equal(validators.length, 1);
    assert.ok(validators[0].warnsWhenExpression);
    // The repeat clone calls .replace on failsWhenExpression, so it must exist and never fail.
    assert.equal(validators[0].failsWhenExpression, 'false');
  });
});
