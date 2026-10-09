import { importOutcomeSnackbar } from './import-outcome';

const t = (_key: string, fallback: string, options?: Record<string, any>) => {
  const template = options?.count === 1 && options?.defaultValue_one ? options.defaultValue_one : fallback;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, name: string) =>
    options && name in options ? String(options[name]) : match,
  );
};

const title = 'Patient imported successfully';

describe('import outcome snackbar', () => {
  it('is a success naming how many facilities the history came from (3a)', () => {
    expect(importOutcomeSnackbar({ localUuid: 'p', history: 'retrieved', facilityCount: 2 }, title, t)).toEqual({
      kind: 'success',
      title,
      subtitle: 'Records from 2 other facilities are in External records.',
    });
  });

  it('uses the singular for one facility', () => {
    expect(importOutcomeSnackbar({ localUuid: 'p', history: 'retrieved', facilityCount: 1 }, title, t).subtitle).toBe(
      'Records from 1 other facility are in External records.',
    );
  });

  it('says so when central holds nothing from other facilities', () => {
    expect(importOutcomeSnackbar({ localUuid: 'p', history: 'retrieved', facilityCount: 0 }, title, t)).toEqual({
      kind: 'success',
      title,
      subtitle: 'No records from other facilities',
    });
  });

  it('is a warning when the history was not retrieved (3b)', () => {
    expect(importOutcomeSnackbar({ localUuid: 'p', history: 'notRetrieved', facilityCount: 0 }, title, t)).toEqual({
      kind: 'warning',
      title,
      subtitle: 'History from other facilities will be retrieved later.',
    });
  });

  it('keeps a title the deployment has reworded', () => {
    expect(
      importOutcomeSnackbar({ localUuid: 'p', history: 'notRetrieved', facilityCount: 0 }, 'Imported', t).title,
    ).toBe('Imported');
  });
});
