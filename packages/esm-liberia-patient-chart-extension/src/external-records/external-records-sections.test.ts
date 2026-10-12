import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSections } from './external-records.ts';
import { sectionDefinitions, sectionIds, statusDisplay } from './external-records-sections.ts';

const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    options && name in options ? String(options[name]) : match,
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

const cells = (id: string) => {
  const section = sectionDefinitions[id];
  return section.rows(sections).map((row) => section.columns.map((column) => column.value(row, formatDate)));
};

describe('section definitions', () => {
  it('offers allergies and conditions for the summary card', () => {
    assert.deepEqual(sectionIds, ['allergies', 'conditions']);
  });

  it('lists allergies as in mockup 4a; the table adds Facility', () => {
    assert.deepEqual(
      sectionDefinitions.allergies.columns.map((column) => column.header(t)),
      ['Allergen', 'Severity', 'Reaction'],
    );
    assert.deepEqual(cells('allergies'), [['Penicillin', 'Moderate', 'Rash, Itching']]);
  });

  it('lists active conditions with their onset date', () => {
    assert.equal(sectionDefinitions.conditions.title(t), 'Active Conditions');
    assert.deepEqual(cells('conditions'), [['Anaemia in pregnancy', '<2026-06-02>', 'Active']]);
  });

  it('leaves a missing date blank', () => {
    const row = { id: 'c2', facility: { uuid: null, name: null }, condition: 'Asthma' };
    assert.equal(sectionDefinitions.conditions.columns[1].value(row, formatDate), '');
  });
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
});
