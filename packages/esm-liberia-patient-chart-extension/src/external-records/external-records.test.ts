import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ancSummaryTag,
  countRows,
  programmeStateExtension,
  refreshSnackbar,
  toFacilities,
  toSections,
  toStatus,
  type LocalHistoryResponse,
  type RefreshResponse,
} from './external-records.ts';

const careysburg = { sourceFacilityUuid: 'f-careysburg', sourceFacilityName: 'Careysburg Health Center' };
const barnersville = { sourceFacilityUuid: 'f-barnersville', sourceFacilityName: 'Barnersville Clinic' };

const bundle = (...resources: Array<Record<string, unknown>>) => ({
  entry: resources.map((resource) => ({ resource })),
});

const sources: LocalHistoryResponse['sources'] = [
  {
    ...careysburg,
    bundle: bundle(
      {
        resourceType: 'AllergyIntolerance',
        id: 'a1',
        code: { text: 'Penicillin' },
        category: ['drug'],
        criticality: 'Severe',
        reaction: [{ manifestation: [{ text: 'Rash' }, { coding: [{ display: 'Hives' }] }] }],
        recordedDate: '2026-03-01T00:00:00Z',
      },
      { resourceType: 'Condition', id: 'c1', code: { text: 'Hypertension' }, onsetDateTime: '2025-01-01T00:00:00Z' },
      {
        resourceType: 'MedicationRequest',
        id: 'm1',
        medicationCodeableConcept: { text: 'Amlodipine 5mg' },
        dosageInstruction: [{ text: '5 mg once daily' }],
      },
      {
        resourceType: 'Immunization',
        id: 'i1',
        vaccineCode: { text: 'Tetanus toxoid' },
        occurrenceDateTime: '2026-02-01T00:00:00Z',
      },
      {
        resourceType: 'EpisodeOfCare',
        id: 'p1',
        status: 'active',
        type: [{ text: 'Antenatal care' }],
        period: { start: '2026-01-10T00:00:00Z' },
        extension: [
          { url: programmeStateExtension, valueString: 'Active' },
          { url: 'other', valueString: 'x' },
        ],
      },
      { resourceType: 'Encounter', id: 'e1', type: [{ text: 'ANC' }], period: { start: '2026-02-01T09:00:00Z' } },
      {
        resourceType: 'Observation',
        id: 'o1',
        meta: { tag: [{ code: ancSummaryTag }] },
        encounter: { reference: 'Encounter/e1' },
        effectiveDateTime: '2026-02-01T09:00:00Z',
        valueQuantity: { value: 20, unit: 'weeks' },
      },
      {
        resourceType: 'Observation',
        id: 'o2',
        meta: { tag: [{ code: ancSummaryTag }] },
        encounter: { reference: 'Encounter/e1' },
        effectiveDateTime: '2026-02-01T09:00:00Z',
        valueDateTime: '2026-03-01T00:00:00Z',
      },
      { resourceType: 'Observation', id: 'untagged', valueQuantity: { value: 99 } },
    ),
  },
  {
    ...barnersville,
    bundle: bundle({
      resourceType: 'Encounter',
      id: 'e2',
      type: [{ text: 'OPD Visit' }],
      period: { start: '2026-04-01T09:00:00Z' },
    }),
  },
];

describe('toSections', () => {
  const sections = toSections(sources);

  it('reads every section and keeps each row’s source facility', () => {
    assert.deepEqual(sections.allergies[0], {
      id: 'a1',
      facility: { uuid: 'f-careysburg', name: 'Careysburg Health Center' },
      allergen: 'Penicillin',
      category: 'drug',
      criticality: 'Severe',
      reactions: ['Rash', 'Hives'],
      recordedDate: '2026-03-01T00:00:00Z',
    });
    assert.equal(sections.conditions[0].condition, 'Hypertension');
    assert.equal(sections.medications[0].dosage, '5 mg once daily');
    assert.equal(sections.immunisations[0].vaccine, 'Tetanus toxoid');
    assert.deepEqual(sections.programmes[0].currentStates, ['Active']);
    assert.equal(sections.programmes[0].active, true);
  });

  it('builds the last ANC contact from its tagged observations only', () => {
    assert.deepEqual(sections.lastAncContact, {
      facility: { uuid: 'f-careysburg', name: 'Careysburg Health Center' },
      contactDate: '2026-02-01T09:00:00Z',
      gestationalAgeWeeks: 20,
      nextContactDate: '2026-03-01T00:00:00Z',
    });
  });

  it('lists encounters newest first across facilities', () => {
    assert.deepEqual(
      sections.encounters.map((encounter) => [encounter.id, encounter.facility.name]),
      [
        ['e2', 'Barnersville Clinic'],
        ['e1', 'Careysburg Health Center'],
      ],
    );
  });

  it('counts rows per facility for the filter', () => {
    assert.deepEqual(
      toFacilities(sections).map((facility) => [facility.name, facility.count]),
      [
        ['Careysburg Health Center', 7],
        ['Barnersville Clinic', 1],
      ],
    );
  });

  it('is empty for no sources or empty bundles', () => {
    assert.equal(countRows(toSections(undefined)), 0);
    assert.equal(countRows(toSections([{ ...careysburg, bundle: null }])), 0);
  });
});

describe('toStatus', () => {
  const imported = (overrides: Partial<LocalHistoryResponse>): LocalHistoryResponse => ({
    patientUuid: 'p',
    imported: true,
    status: 'fresh',
    fetchedAt: '2026-10-09T08:00:00Z',
    ...overrides,
  });

  it('is null for a patient never imported, or before the first answer', () => {
    assert.equal(toStatus({ patientUuid: 'p', imported: false }, 0, false), null);
    assert.equal(toStatus(undefined, 0, false), null);
  });

  for (const status of ['fresh', 'stale', 'offline', 'notRetrieved', 'unavailableOffline'] as const) {
    it(`passes the server's ${status} through when there are rows`, () => {
      const fetchedAt = status === 'notRetrieved' || status === 'unavailableOffline' ? null : '2026-10-09T08:00:00Z';
      assert.equal(toStatus(imported({ status, fetchedAt }), 3, false), status);
    });
  }

  it('is empty when central answered with nothing from other facilities (6f)', () => {
    assert.equal(toStatus(imported({ status: 'fresh' }), 0, false), 'empty');
    assert.equal(toStatus(imported({ status: 'stale' }), 0, false), 'empty');
  });

  it('keeps notRetrieved when central never answered, even with no rows', () => {
    assert.equal(toStatus(imported({ status: 'notRetrieved', fetchedAt: null }), 0, false), 'notRetrieved');
  });

  it('is offline when this server can no longer be reached but a copy was loaded', () => {
    assert.equal(toStatus(imported({ status: 'fresh' }), 3, true), 'offline');
  });

  it('is unavailableOffline when nothing was ever loaded or fetched', () => {
    assert.equal(toStatus(undefined, 0, true), 'unavailableOffline');
    assert.equal(toStatus(imported({ status: 'notRetrieved', fetchedAt: null }), 0, true), 'unavailableOffline');
  });

  it('treats an unknown server status as not retrieved', () => {
    assert.equal(toStatus(imported({ status: 'surprise' }), 3, false), 'notRetrieved');
  });
});

describe('refreshSnackbar', () => {
  const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
      options && name in options ? String(options[name]) : match,
    );
  const asOf = (when: string) => `<${when}>`;
  const result = (overrides: Partial<RefreshResponse>): RefreshResponse => ({
    attempt: 'ok',
    history: 'retrieved',
    status: 'fresh',
    facilityCount: 2,
    fetchedAt: '2026-10-09T12:05:00Z',
    ...overrides,
  });

  it('succeeds with the new copy’s time (3d)', () => {
    assert.deepEqual(refreshSnackbar(result({}), '2026-10-02T08:14:00Z', asOf, t), {
      kind: 'success',
      title: 'External records refreshed',
      subtitle: 'Showing records as of <2026-10-09T12:05:00Z>.',
    });
  });

  it('warns and keeps the cached copy’s time when central could not be reached (3e)', () => {
    const failed = result({ attempt: 'unreachable', history: 'notRetrieved', fetchedAt: '2026-10-02T08:14:00Z' });
    assert.deepEqual(refreshSnackbar(failed, '2026-10-02T08:14:00Z', asOf, t), {
      kind: 'warning',
      title: 'Could not refresh from central',
      subtitle: 'Still showing records as of <2026-10-02T08:14:00Z>.',
    });
  });

  it('falls back to the copy shown before when the request itself failed', () => {
    assert.equal(
      refreshSnackbar(null, '2026-10-02T08:14:00Z', asOf, t).subtitle,
      'Still showing records as of <2026-10-02T08:14:00Z>.',
    );
  });

  it('says the history comes later when there is no copy at all (6d, 6e)', () => {
    const failed = result({ attempt: 'error', history: 'notRetrieved', fetchedAt: null });
    assert.deepEqual(refreshSnackbar(failed, null, asOf, t), {
      kind: 'warning',
      title: 'Could not refresh from central',
      subtitle: 'History from other facilities will be retrieved later.',
    });
  });
});
