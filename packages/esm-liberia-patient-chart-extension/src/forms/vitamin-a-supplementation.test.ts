import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  VITAMIN_A_MINIMUM_INTERVAL_DAYS,
  VITAMIN_A_RED_REPEAT_ALLOWED_BEFORE_ROUTINE,
  addCalendarDays,
  addCalendarMonths,
  evaluateVitaminADose,
  vitaminAAdministrationsFromObs,
  vitaminABlock,
  vitaminACurrentStrength,
  vitaminAEncounterUuidFromWorkspace,
  vitaminAReturnDate,
  vitaminAReturnDateValue,
  vitaminARouteRejected,
  vitaminARouteValue,
  vitaminASharedReturnValue,
  vitaminAStrengthForAge,
  type VitaminAAdministration,
  type VitaminAConcepts,
} from './vitamin-a-supplementation.ts';

const BLUE = 'blue-uuid';
const RED = 'red-uuid';
const DATE_RECEIVED = 'date-received-uuid';
const ORAL = 'oral-uuid';
const INTRADERMAL = 'intradermal-uuid';
const concepts: VitaminAConcepts = { blue: BLUE, red: RED, dateReceived: DATE_RECEIVED };

function dose(partial: Partial<VitaminAAdministration> & Pick<VitaminAAdministration, 'id' | 'strength' | 'administeredDate'>): VitaminAAdministration {
  return {
    dateSource: 'date-received',
    encounterUuid: `${partial.id}-enc`,
    encounterDate: partial.administeredDate,
    ...partial,
  };
}

function decide(input: {
  birthDate: string;
  asOf: string;
  dateGiven?: string;
  strength?: 'blue' | 'red' | '';
  history?: VitaminAAdministration[];
  mode?: string;
  currentEncounterUuid?: string;
}) {
  return evaluateVitaminADose({
    birthDate: input.birthDate,
    asOf: input.asOf,
    dateGiven: input.dateGiven ?? input.asOf,
    strengthUuid: input.strength === 'blue' ? BLUE : input.strength === 'red' ? RED : '',
    history: JSON.stringify(input.history ?? []),
    concepts,
    mode: input.mode,
    currentEncounterUuid: input.currentEncounterUuid,
  });
}

describe('calendar arithmetic', () => {
  it('uses the exact 6-month, 12-month and 5th-birthday boundaries', () => {
    const birth = '2019-01-15';
    assert.equal(vitaminAStrengthForAge(birth, '2019-07-14'), null);
    assert.equal(vitaminAStrengthForAge(birth, '2019-07-15'), 'blue');
    assert.equal(vitaminAStrengthForAge(birth, '2019-12-15'), 'blue');
    assert.equal(vitaminAStrengthForAge(birth, '2020-01-14'), 'blue');
    assert.equal(vitaminAStrengthForAge(birth, '2020-01-15'), 'red');
    assert.equal(vitaminAStrengthForAge(birth, '2024-01-14'), 'red');
    assert.equal(vitaminAStrengthForAge(birth, '2024-01-15'), null);
  });

  it('clamps month-end and leap-year birthdays instead of counting days', () => {
    assert.equal(addCalendarMonths('2019-08-31', 6), '2020-02-29');
    assert.equal(vitaminAStrengthForAge('2019-08-31', '2020-02-28'), null);
    assert.equal(vitaminAStrengthForAge('2019-08-31', '2020-02-29'), 'blue');

    assert.equal(addCalendarMonths('2020-02-29', 12), '2021-02-28');
    assert.equal(addCalendarMonths('2020-02-29', 48), '2024-02-29');
    assert.equal(addCalendarMonths('2020-02-29', 60), '2025-02-28');
    assert.equal(vitaminAStrengthForAge('2020-02-29', '2021-02-27'), 'blue');
    assert.equal(vitaminAStrengthForAge('2020-02-29', '2021-02-28'), 'red');
    assert.equal(vitaminAStrengthForAge('2020-02-29', '2025-02-27'), 'red');
    assert.equal(vitaminAStrengthForAge('2020-02-29', '2025-02-28'), null);
  });

  it('does not replace six calendar months with 180 days', () => {
    assert.equal(addCalendarMonths('2024-08-31', 6), '2025-02-28');
    assert.notEqual(addCalendarMonths('2024-08-31', 6), addCalendarDays('2024-08-31', 180));
    assert.equal(addCalendarMonths('2024-01-31', 6), '2024-07-31');
  });
});

describe('Blue once in the 6-11 month band', () => {
  const birth = '2023-01-15';
  const asOf = '2023-08-15';

  it('allows the first Blue dose', () => {
    const result = decide({ birthDate: birth, asOf, strength: 'blue' });
    assert.equal(result.block, '');
    assert.equal(result.canAdminister, true);
    assert.equal(result.routinelyDue, true);
  });

  it('blocks a second Blue dose', () => {
    const result = decide({
      birthDate: birth,
      asOf,
      strength: 'blue',
      history: [dose({ id: 'prior-blue', strength: 'blue', administeredDate: '2023-07-15' })],
    });
    assert.equal(result.block, 'blue-repeat');
    assert.equal(result.canAdminister, false);
  });

  it('does not offer Blue after a previous Red once the child is in the Red band', () => {
    const result = decide({
      birthDate: birth,
      asOf: '2024-04-15',
      strength: 'blue',
      history: [dose({ id: 'prior-red', strength: 'red', administeredDate: '2024-02-01' })],
    });
    assert.equal(result.block, 'age');
    assert.equal(result.currentStrength, 'red');
  });
});

describe('Red six-calendar-month schedule', () => {
  const birth = '2022-01-15';

  it('allows Red at the first presentation after 12 months', () => {
    const result = decide({ birthDate: birth, asOf: '2023-04-15', strength: 'red' });
    assert.equal(result.currentStrength, 'red');
    assert.equal(result.block, '');
    assert.equal(result.routinelyDue, true);
    assert.equal(result.canAdminister, true);
  });

  it('is not routinely due the day before six calendar months and is due on that day', () => {
    const previous = '2024-01-31';
    const history = [dose({ id: 'prior-red', strength: 'red', administeredDate: previous })];
    const dayBefore = decide({
      birthDate: birth,
      asOf: '2024-07-30',
      strength: 'red',
      history,
    });
    const dueDay = decide({
      birthDate: birth,
      asOf: '2024-07-31',
      strength: 'red',
      history,
    });
    assert.equal(addCalendarMonths(previous, 6), '2024-07-31');
    assert.equal(dayBefore.routinelyDue, false);
    assert.equal(dayBefore.canAdminister, true);
    assert.equal(dayBefore.minimumIntervalSatisfied, true);
    assert.equal(dueDay.routinelyDue, true);
    assert.equal(dueDay.block, '');
  });

  it('anchors the next routine date to the actual administration date', () => {
    assert.equal(vitaminAReturnDate(birth, '2024-01-31', 'red', '2024-01-31'), '2024-07-31');
  });
});

describe('provisional 30-day minimum interval', () => {
  const birth = '2022-01-15';
  const previous = '2024-03-01';
  const history = [dose({ id: 'prior', strength: 'red', administeredDate: previous })];

  it('blocks a dose before 30 days and allows the 30th day without calling it routinely due', () => {
    assert.equal(VITAMIN_A_MINIMUM_INTERVAL_DAYS, 30);
    assert.equal(VITAMIN_A_RED_REPEAT_ALLOWED_BEFORE_ROUTINE, true);
    const tooSoon = decide({ birthDate: birth, asOf: '2024-03-30', strength: 'red', history });
    const day30 = decide({ birthDate: birth, asOf: '2024-03-31', strength: 'red', history });
    assert.equal(tooSoon.block, 'minimum-interval');
    assert.equal(tooSoon.canAdminister, false);
    assert.equal(day30.block, '');
    assert.equal(day30.minimumIntervalSatisfied, true);
    assert.equal(day30.routinelyDue, false);
    assert.equal(day30.canAdminister, true);
  });

  it('applies the same floor after Blue or Red', () => {
    const afterBlue = decide({
      birthDate: '2023-01-15',
      asOf: '2024-01-18',
      strength: 'red',
      history: [dose({ id: 'blue', strength: 'blue', administeredDate: '2023-12-20' })],
    });
    assert.equal(afterBlue.block, 'minimum-interval');
  });
});

describe('catch-up uses current age', () => {
  const birth = '2023-01-15';

  it('offers Red, never Blue, when Blue was missed and the child is now 12 months', () => {
    const blue = decide({ birthDate: birth, asOf: '2024-01-15', strength: 'blue' });
    const red = decide({ birthDate: birth, asOf: '2024-01-15', strength: 'red' });
    assert.equal(blue.block, 'age');
    assert.equal(red.block, '');
    assert.equal(red.routinelyDue, true);
  });

  it('lets Red follow Blue once the minimum gap has elapsed, before six months', () => {
    const result = decide({
      birthDate: birth,
      asOf: '2024-01-15',
      strength: 'red',
      history: [dose({ id: 'blue', strength: 'blue', administeredDate: '2023-12-15' })],
    });
    assert.equal(result.currentStrength, 'red');
    assert.equal(result.block, '');
    assert.equal(result.minimumIntervalSatisfied, true);
    assert.equal(result.routinelyDue, false);
  });

  it('does not backfill Blue for a child who first presents in the Red band', () => {
    const result = decide({ birthDate: birth, asOf: '2024-04-15', strength: 'blue' });
    assert.equal(result.block, 'age');
  });
});

describe('return date', () => {
  it('schedules the earliest valid Red date after Blue, not another Blue', () => {
    assert.equal(vitaminAReturnDate('2023-01-15', '2023-07-15', 'blue', '2023-07-15'), '2024-01-15');
    assert.equal(vitaminAReturnDate('2023-01-15', '2023-12-20', 'blue', '2023-12-20'), '2024-01-19');
  });

  it('schedules Red six calendar months later and omits a date on or after the 5th birthday', () => {
    assert.equal(vitaminAReturnDate('2019-01-15', '2023-06-15', 'red', '2023-06-15'), '2023-12-15');
    assert.equal(vitaminAReturnDate('2019-01-15', '2023-08-15', 'red', '2023-08-15'), null);
  });

  it('does not generate a return date that is not still in the future', () => {
    assert.equal(vitaminAReturnDate('2023-01-15', '2023-07-15', 'blue', '2024-02-01'), null);
  });
});

describe('administration history', () => {
  it('reads Blue and Red observations and prefers Date received over the encounter date', () => {
    const read = vitaminAAdministrationsFromObs(
      [
        {
          uuid: 'blue-obs',
          value: { uuid: BLUE },
          encounter: {
            uuid: 'enc-1',
            encounterDatetime: '2023-08-02T09:00:00.000+0000',
            obs: [{ uuid: 'date-obs', concept: { uuid: DATE_RECEIVED }, value: '2023-08-01' }],
          },
        },
        {
          uuid: 'red-obs',
          value: RED,
          encounter: { uuid: 'enc-2', encounterDatetime: '2024-03-01T09:00:00.000+0000', obs: [] },
        },
      ],
      concepts,
    );
    assert.equal(read.complete, true);
    assert.deepEqual(
      read.administrations.map((item) => [item.strength, item.administeredDate, item.dateSource]),
      [
        ['blue', '2023-08-01', 'date-received'],
        ['red', '2024-03-01', 'encounter-datetime'],
      ],
    );
  });

  it('does not treat a medication request or drug order as an administered dose', () => {
    const read = vitaminAAdministrationsFromObs(
      [
        { resourceType: 'MedicationRequest', uuid: 'rx', value: { uuid: BLUE } },
        { uuid: 'order', type: 'drugorder', drug: { uuid: 'vitamin-a-capsule' } },
      ],
      concepts,
    );
    assert.equal(read.complete, true);
    assert.deepEqual(read.administrations, []);
  });

  it('ignores a voided observation', () => {
    const read = vitaminAAdministrationsFromObs(
      [{ uuid: 'voided', voided: true, value: { uuid: BLUE }, encounter: { uuid: 'enc', encounterDatetime: '2023-08-01' } }],
      concepts,
    );
    assert.deepEqual(read.administrations, []);
    assert.equal(read.complete, true);
  });

  it('excludes only the encounter being edited, not another encounter on the same day', () => {
    const sameDayOther = dose({
      id: 'other-visit',
      strength: 'blue',
      administeredDate: '2023-08-15',
      encounterDate: '2023-08-15',
      encounterUuid: 'other-encounter',
    });
    const thisVisit = dose({
      id: 'this-visit',
      strength: 'blue',
      administeredDate: '2023-08-01',
      encounterDate: '2023-08-15',
      encounterUuid: 'this-encounter',
    });
    const editingThisVisit = decide({
      birthDate: '2023-01-15',
      asOf: '2023-08-15',
      strength: 'blue',
      mode: 'edit',
      currentEncounterUuid: 'this-encounter',
      history: [thisVisit],
    });
    const otherEncounterSameDay = decide({
      birthDate: '2023-01-15',
      asOf: '2023-08-15',
      strength: 'blue',
      mode: 'edit',
      currentEncounterUuid: 'this-encounter',
      history: [sameDayOther],
    });
    const missingEncounterId = decide({
      birthDate: '2023-01-15',
      asOf: '2023-08-15',
      strength: 'blue',
      mode: 'edit',
      history: [sameDayOther],
    });
    assert.equal(editingThisVisit.block, '');
    assert.equal(otherEncounterSameDay.block, 'blue-repeat');
    assert.equal(missingEncounterId.block, 'blue-repeat');
  });

  it('still counts a same-day dose when the form is not editing that encounter', () => {
    const result = decide({
      birthDate: '2023-01-15',
      asOf: '2023-08-15',
      strength: 'blue',
      mode: 'enter',
      currentEncounterUuid: 'other-encounter',
      history: [
        dose({
          id: 'morning',
          strength: 'blue',
          administeredDate: '2023-08-15',
          encounterDate: '2023-08-15',
          encounterUuid: 'other-encounter',
        }),
      ],
    });
    assert.equal(result.block, 'blue-repeat');
  });
});

describe('form-engine entry points', () => {
  const birth = '2019-01-15';
  const history = '[]';

  it('reports the strength for the exact age boundaries', () => {
    assert.equal(vitaminACurrentStrength(birth, '2019-07-14'), '');
    assert.equal(vitaminACurrentStrength(birth, '2019-07-15'), 'blue');
    assert.equal(vitaminACurrentStrength(birth, '2020-01-14'), 'blue');
    assert.equal(vitaminACurrentStrength(birth, '2020-01-15'), 'red');
    assert.equal(vitaminACurrentStrength(birth, '2024-01-14'), 'red');
    assert.equal(vitaminACurrentStrength(birth, '2024-01-15'), '');
  });

  it('rejects a future Date received, a date before birth, and a date after the encounter', () => {
    const asOf = '2023-06-15';
    assert.equal(vitaminABlock(birth, asOf, '', RED, history, BLUE, RED, 'enter'), 'date');
    assert.equal(vitaminABlock(birth, asOf, '2023-06-16', RED, history, BLUE, RED, 'enter'), 'date');
    assert.equal(vitaminABlock(birth, asOf, '2019-01-14', RED, history, BLUE, RED, 'enter'), 'date');
    assert.equal(vitaminABlock(birth, asOf, asOf, RED, history, BLUE, RED, 'enter'), '');
  });

  it('drops the encounter being edited and keeps a different encounter', () => {
    const prior = JSON.stringify([
      dose({
        id: 'this',
        strength: 'blue',
        administeredDate: '2019-08-01',
        encounterDate: '2019-08-15',
        encounterUuid: 'this-encounter',
      }),
    ]);
    assert.equal(
      vitaminABlock(birth, '2019-08-15', '2019-08-15', BLUE, prior, BLUE, RED, 'edit', 'this-encounter'),
      '',
    );
    assert.equal(
      vitaminABlock(birth, '2019-08-15', '2019-08-15', BLUE, prior, BLUE, RED, 'edit', 'other-encounter'),
      'blue-repeat',
    );
  });

  it('returns a Date for a valid Red return date and null once that date leaves the age window', () => {
    const valid = vitaminAReturnDateValue(birth, '2023-06-15', RED, BLUE, RED, '2023-06-15');
    assert.ok(valid instanceof Date);
    assert.equal(valid?.getFullYear(), 2023);
    assert.equal(valid?.getMonth(), 11);
    assert.equal(valid?.getDate(), 15);
    assert.equal(vitaminAReturnDateValue(birth, '2023-08-15', RED, BLUE, RED, '2023-08-15'), null);
  });
});

describe('shared route and return date', () => {
  const birth = '2019-01-15';
  const stale = new Date(2023, 11, 1, 12, 0, 0, 0);

  it('defaults Oral only for Vitamin A alone and rejects a non-Oral route', () => {
    assert.equal(vitaminARouteValue('', RED, '', ORAL), ORAL);
    assert.equal(vitaminARouteRejected('', RED, INTRADERMAL, ORAL), true);
    assert.equal(vitaminARouteRejected('', RED, ORAL, ORAL), false);
  });

  it('does not default or reject the route when a vaccine is selected', () => {
    assert.equal(vitaminARouteValue('bcg', RED, INTRADERMAL, ORAL), INTRADERMAL);
    assert.equal(vitaminARouteValue('bcg', RED, '', ORAL), '');
    assert.equal(vitaminARouteRejected('bcg', RED, INTRADERMAL, ORAL), false);
    assert.equal(vitaminARouteValue('bcg', '', INTRADERMAL, ORAL), INTRADERMAL);
    assert.equal(vitaminARouteRejected('', '', INTRADERMAL, ORAL), false);
  });

  it('clears a stale Vitamin A return date that is now outside the age window', () => {
    const cleared = vitaminASharedReturnValue('', birth, '2023-08-15', RED, BLUE, RED, '2023-08-15', stale);
    assert.equal(cleared, null);
  });

  it('leaves a vaccine return date in place on a combined visit', () => {
    const kept = vitaminASharedReturnValue('bcg', birth, '2023-08-15', RED, BLUE, RED, '2023-08-15', stale);
    assert.equal(kept, stale);
  });
});

describe('editing encounter identity', () => {
  it('reads the encounter UUID from the open form workspace and ignores another window', () => {
    const state = {
      openedWindows: [
        {
          openedWorkspaces: [
            { workspaceName: 'patient-form-entry-workspace', props: { encounterUuid: 'older-encounter' } },
          ],
        },
        {
          openedWorkspaces: [
            { workspaceName: 'order-basket-workspace', props: { encounterUuid: 'not-this-form' } },
            { workspaceName: 'patient-form-entry-workspace', props: { encounterUuid: 'current-encounter' } },
          ],
        },
      ],
    };
    assert.equal(vitaminAEncounterUuidFromWorkspace(state), 'current-encounter');
    assert.equal(vitaminAEncounterUuidFromWorkspace({ openedWindows: [] }), '');
  });
});

describe('form and concept metadata', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const form = JSON.parse(
    readFileSync(
      resolve(root, 'content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json'),
      'utf8',
    ),
  ) as { version: string; pages: Array<{ sections: Array<{ questions: Array<Record<string, unknown>> }> }> };
  const questions = form.pages.flatMap((page) => page.sections.flatMap((section) => section.questions));
  const byId = (id: string) => questions.find((question) => question.id === id);

  it('is Immunization version 1.7', () => {
    assert.equal(form.version, '1.7');
  });

  it('blocks an age-inappropriate strength, requires Date received, defaults Oral, and calculates the return date', () => {
    const activity = byId('supp_activities');
    const dateReceived = byId('vitamin_a_date_received');
    const route = byId('route');
    const returnDate = byId('return_date');
    const answers = (activity?.questionOptions as { answers: Array<{ concept: string; label: string; hide?: { hideWhenExpression: string } }> }).answers;
    assert.deepEqual(
      answers.map((answer) => answer.concept),
      [
        '${var.concept.national.vit-a-blue-100-000iu.uuid}',
        '${var.concept.national.vit-a-red-200-000iu.uuid}',
      ],
    );
    assert.match(answers[0].hide?.hideWhenExpression ?? '', /vitaminACurrentStrength/);
    assert.match(answers[1].hide?.hideWhenExpression ?? '', /!== 'red'/);
    const failures = JSON.stringify((activity?.validators as unknown[]) ?? []);
    assert.match(failures, /vitaminABlock\(/);
    assert.match(failures, /=== 'age'/);
    assert.match(failures, /=== 'blue-repeat'/);
    assert.match(failures, /=== 'minimum-interval'/);
    assert.match(JSON.stringify(dateReceived?.validators ?? []), /Date received is required/);
    assert.match(JSON.stringify(dateReceived?.validators ?? []), /allowFutureDates":"false"/);
    const routeCalculate = (route?.questionOptions as { calculate?: { calculateExpression: string } }).calculate
      ?.calculateExpression;
    const routeFailures = JSON.stringify(route?.validators ?? []);
    assert.equal(
      routeCalculate,
      "vitaminARouteValue(vaccine_name, supp_activities, myValue, '${var.concept.ciel.oral.uuid}')",
    );
    assert.match(routeFailures, /vitaminARouteRejected\(vaccine_name, supp_activities, myValue/);
    assert.doesNotMatch(routeCalculate ?? '', /isEmpty\(supp_activities\) && isEmpty\(myValue\)/);
    assert.equal(
      (returnDate?.questionOptions as { calculate?: { calculateExpression: string } }).calculate?.calculateExpression,
      "vitaminASharedReturnValue(vaccine_name, patient.birthDate, vitamin_a_date_received, supp_activities, '${var.concept.national.vit-a-blue-100-000iu.uuid}', '${var.concept.national.vit-a-red-200-000iu.uuid}', today(), myValue)",
    );
    assert.match(failures, /vitaminAEditingEncounterUuid\(\)/);
  });

  it('declares Red once, leaves the Blue UUID unchanged, and does not describe Red as 20,000 IU', () => {
    const variables = readFileSync(
      resolve(root, 'content-packages/content-liberia-national/configuration/variables.properties'),
      'utf8',
    );
    const conceptsCsv = readFileSync(
      resolve(root, 'content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv'),
      'utf8',
    );
    assert.match(variables, /^var\.form\.immunization\.uuid=e44cf2d4-169e-3c98-a617-f7d937fbcd74$/m);
    assert.match(variables, /^var\.form\.immunization\.v1-6\.uuid=337600b2-9ea3-310a-bbc5-cb2dfa221318$/m);
    assert.match(variables, /v1\.1 5ec3f3ef-f63d-3d4a-a828-8a0be01c1fb8/);
    assert.match(variables, /v1\.2 af9b642f-15d7-3687-812d-9ea2c890cfbd/);
    assert.match(variables, /v1\.3 c1b0a028-d35d-3f54-a240-c027d51ac1df/);
    assert.match(variables, /v1\.4 36f41158-2060-399d-959b-f99718b154be/);
    assert.match(variables, /v1\.5 ed2202f0-c074-34ab-bde0-a08468ab3900/);
    assert.match(variables, /^var\.concept\.national\.vit-a-blue-100-000iu\.uuid=eb2f71a4-6689-464b-9d2c-76e84ef0cc76$/m);
    assert.match(variables, /^var\.concept\.national\.vit-a-red-200-000iu\.uuid=e74aef5c-305c-45c5-9669-3338c30072fa$/m);
    assert.equal(conceptsCsv.split('vit-a-red-200-000iu').length - 1, 2);
    assert.match(conceptsCsv, /Vitamin A supplementation administered, 200,000 IU/);
    assert.doesNotMatch(conceptsCsv, /20,000 IU|10,000 IU|20,000iu|10,000iu/);
    assert.doesNotMatch(conceptsCsv, /vit-a-red-200-000iu.*984|CIEL:984/);
  });

  it('counts Vitamin A from every Immunization form version, including the retired v1.1 fixture', () => {
    const sql = readFileSync(
      resolve(root, 'modules/mambaetl/api/src/main/mamba/_etl/derived/nutrition/sp_mamba_fact_nutrition_vitamin_a.sql'),
      'utf8',
    );
    assert.match(sql, /f\.name = 'Immunization'/);
    assert.match(sql, /f\.version IN \('1\.1', '1\.2', '1\.3', '1\.4', '1\.5', '1\.6', '1\.7'\)/);
    assert.match(sql, /f\.uuid = '\$\{var\.form\.immunization\.uuid\}'/);
    assert.doesNotMatch(sql, /ef\.form_uuid = '\$\{var\.form\.immunization\.uuid\}'/);
    const forms = readFileSync(resolve(root, 'qa/reporting/fixtures/forms.csv'), 'utf8');
    assert.match(forms, /^immunization-v1\.1,form:Immunization@1\.1,.*create-retired,/m);
  });
});
