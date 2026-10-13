import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSections } from './external-records.ts';
import { formatGestationalAge, sectionDefinitions, sectionIds, statusDisplay } from './external-records-sections.ts';

const t = (_key: string, fallback: string, options?: Record<string, any>) =>
  (options?.count === 1 && options?.defaultValue_one ? options.defaultValue_one : fallback).replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (match: string, name: string) => (options && name in options ? String(options[name]) : match),
  );
const formatDate = (iso: string) => `<${iso.slice(0, 10)}>`;

const sections = toSections([
  {
    sourceFacilityUuid: 'f1',
    sourceFacilityName: 'Barnersville Clinic',
    bundle: {
      entry: [
        {
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'a1',
            code: { text: 'Penicillin' },
            criticality: 'Moderate',
            reaction: [{ manifestation: [{ text: 'Rash' }, { text: 'Itching' }] }],
          },
        },
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            code: { text: 'Anaemia in pregnancy' },
            onsetDateTime: '2026-06-02T00:00:00Z',
          },
        },
      ],
    },
  },
]);

const summaryCells = (id: string) => {
  const section = sectionDefinitions[id];
  const columns = section.summaryColumns ?? section.columns;
  return section.rows(sections).map((row) => columns.map((column) => column.value(row, formatDate)));
};

const cells = (id: string) => {
  const section = sectionDefinitions[id];
  return section.rows(sections).map((row) => section.columns.map((column) => column.value(row, formatDate)));
};

describe('section definitions', () => {
  it('defines every dashboard section in order (5a)', () => {
    assert.deepEqual(sectionIds, [
      'allergies',
      'conditions',
      'medications',
      'immunisations',
      'programmes',
      'encounters',
    ]);
  });

  it('gives the dashboard its own allergy and condition columns, keeping the card’s', () => {
    assert.deepEqual(
      sectionDefinitions.allergies.columns.map((column) => column.header(t)),
      ['Allergen', 'Reaction · severity', 'Recorded'],
    );
    assert.deepEqual(
      sectionDefinitions.conditions.columns.map((column) => column.header(t)),
      ['Condition', 'Onset'],
    );
    assert.equal(sectionDefinitions.allergies.title(t), 'Allergies and intolerances');
    assert.equal(sectionDefinitions.allergies.summaryTitle?.(t), 'Allergies');
  });

  it('notes the encounter index and ends each row with a contact hint', () => {
    assert.match(sectionDefinitions.encounters.note?.(t) ?? '', /Observations are not shared/);
    assert.equal(sectionDefinitions.encounters.rowNote?.(t), 'Contact the facility for details');
  });

  it('lists allergies on the card as in mockup 4a; the table adds Facility', () => {
    assert.deepEqual(
      (sectionDefinitions.allergies.summaryColumns ?? []).map((column) => column.header(t)),
      ['Allergen', 'Severity', 'Reaction'],
    );
    assert.deepEqual(summaryCells('allergies'), [['Penicillin', 'Moderate', 'Rash, Itching']]);
    assert.deepEqual(cells('allergies'), [['Penicillin', 'Rash, Itching · moderate', '']]);
  });

  it('lists active conditions with their onset date', () => {
    assert.equal(sectionDefinitions.conditions.summaryTitle?.(t), 'Active Conditions');
    assert.deepEqual(summaryCells('conditions'), [['Anaemia in pregnancy', '<2026-06-02>', 'Active']]);
    assert.deepEqual(cells('conditions'), [['Anaemia in pregnancy', '<2026-06-02>']]);
  });

  it('leaves a missing date blank', () => {
    const row = { id: 'c2', facility: { uuid: null, name: null }, condition: 'Asthma' };
    assert.equal(sectionDefinitions.conditions.columns[1].value(row, formatDate), '');
  });
});

describe('formatGestationalAge', () => {
  const cases: Array<[number | undefined, string]> = [
    [28, '28 weeks'],
    [28 + 3 / 7, '28 weeks + 3 days'],
    [38 + 1 / 7, '38 weeks + 1 day'],
    [1, '1 week'],
    [27.99, '28 weeks'],
    [undefined, ''],
  ];
  for (const [weeks, expected] of cases) {
    it(`${weeks} → "${expected}"`, () => assert.equal(formatGestationalAge(weeks, t), expected));
  }
});

describe('statusDisplay', () => {
  const asOf = '02-Oct-2026, 08:14 (2 days ago)';

  it('shows an info bar with Refresh when fresh (6a)', () => {
    assert.deepEqual(statusDisplay('fresh', asOf, t), {
      type: 'bar',
      kind: 'info',
      title: `As of ${asOf}`,
      subtitle: '· Retrieved from Central Instance',
      action: 'Refresh',
    });
  });

  it('warns with Retry when offline (6b)', () => {
    assert.deepEqual(statusDisplay('offline', asOf, t), {
      type: 'bar',
      kind: 'warning',
      title: 'Offline',
      subtitle: `— showing records as of ${asOf}`,
      action: 'Retry',
    });
  });

  it('warns with Retry Refresh when stale (6c)', () => {
    const display = statusDisplay('stale', asOf, t);
    assert.equal(display.type === 'bar' && display.title, 'Could not refresh from central');
    assert.equal(display.action, 'Retry Refresh');
  });

  for (const [status, title] of [
    ['notRetrieved', 'History not yet retrieved'],
    ['unavailableOffline', 'History from other facilities unavailable offline'],
    ['empty', 'No records from other facilities'],
  ] as const) {
    it(`shows the ${status} empty state with Retry (6d–6f)`, () => {
      const display = statusDisplay(status, '', t);
      assert.equal(display.type, 'empty');
      assert.equal(display.title, title);
      assert.equal(display.action, 'Retry');
    });
  }

  it('gives the dashboard longer empty-state text', () => {
    const card = statusDisplay('notRetrieved', '', t);
    const dashboard = statusDisplay('notRetrieved', '', t, true);
    assert.equal(card.type === 'empty' && card.body, 'History from other facilities will be retrieved later.');
    assert.match(dashboard.type === 'empty' ? dashboard.body : '', /retried automatically/);
  });
});
