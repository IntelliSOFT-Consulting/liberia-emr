import { importRemotePatient, pingCentral, refreshRemoteHistory } from './import-patient.resource';
import { type ImportSteps, progressPercent, runImport } from './run-import';

jest.mock('./import-patient.resource', () => ({
  pingCentral: jest.fn(),
  importRemotePatient: jest.fn(),
  refreshRemoteHistory: jest.fn(),
}));

const mockPing = pingCentral as jest.Mock;
const mockImport = importRemotePatient as jest.Mock;
const mockRefresh = refreshRemoteHistory as jest.Mock;

const REMOTE = '22222222-2222-2222-2222-222222222222';

describe('runImport', () => {
  let seen: Array<ImportSteps>;
  const record = (steps: ImportSteps) => seen.push(steps);

  beforeEach(() => {
    jest.resetAllMocks();
    seen = [];
    mockPing.mockResolvedValue(undefined);
    mockImport.mockResolvedValue({ localUuid: REMOTE, created: true, history: 'deferred' });
    mockRefresh.mockResolvedValue({ attempt: 'ok', history: 'retrieved', facilityCount: 2, status: 'fresh' });
  });

  it('moves each step on only when its own request has answered', async () => {
    let finishPing: () => void;
    mockPing.mockReturnValue(new Promise<void>((resolve) => (finishPing = resolve)));

    const running = runImport(REMOTE, 'Visiting patient', record);
    await Promise.resolve();
    expect(seen[seen.length - 1]).toEqual(['active', 'pending', 'pending']);
    expect(mockImport).not.toHaveBeenCalled();

    finishPing();
    await running;

    expect(seen).toEqual([
      ['active', 'pending', 'pending'],
      ['done', 'pending', 'pending'],
      ['done', 'active', 'pending'],
      ['done', 'done', 'pending'],
      ['done', 'done', 'active'],
      ['done', 'done', 'done'],
    ]);
  });

  it('sends the reason with the shell import and with the history fetch', async () => {
    const result = await runImport(REMOTE, 'Referral in', record);

    expect(mockImport).toHaveBeenCalledWith(REMOTE, 'Referral in');
    expect(mockRefresh).toHaveBeenCalledWith(REMOTE, 'Referral in');
    expect(result).toEqual({ localUuid: REMOTE, history: 'retrieved', facilityCount: 2 });
  });

  it('fetches the history for the local patient the import resolved to', async () => {
    mockImport.mockResolvedValue({ localUuid: 'local-duplicate', created: false, history: 'deferred' });

    await runImport(REMOTE, 'Emergency', record);

    expect(mockRefresh).toHaveBeenCalledWith('local-duplicate', 'Emergency');
  });

  it('rejects without importing when central cannot be reached', async () => {
    mockPing.mockRejectedValue(new Error('Failed to contact central server'));

    await expect(runImport(REMOTE, 'Emergency', record)).rejects.toThrow('Failed to contact central server');
    expect(mockImport).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual(['active', 'pending', 'pending']);
  });

  it('rejects when the shell cannot be created, and fetches no history', async () => {
    mockImport.mockRejectedValue(new Error('Failed to import patient from central server'));

    await expect(runImport(REMOTE, 'Emergency', record)).rejects.toThrow();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('keeps the patient when central did not serve the history', async () => {
    mockRefresh.mockResolvedValue({ attempt: 'unreachable', history: 'notRetrieved', facilityCount: 0 });

    await expect(runImport(REMOTE, 'Emergency', record)).resolves.toEqual({
      localUuid: REMOTE,
      history: 'notRetrieved',
      facilityCount: 0,
    });
  });

  it('keeps the patient when the history request itself fails', async () => {
    mockRefresh.mockRejectedValue(new Error('network'));

    const result = await runImport(REMOTE, 'Emergency', record);

    expect(result).toEqual({ localUuid: REMOTE, history: 'notRetrieved', facilityCount: 0 });
    expect(seen[seen.length - 1]).toEqual(['done', 'done', 'done']);
  });
});

describe('progressPercent', () => {
  it('counts finished steps and half of the running one', () => {
    expect(progressPercent(['pending', 'pending', 'pending'])).toBe(0);
    expect(progressPercent(['active', 'pending', 'pending'])).toBe(17);
    expect(progressPercent(['done', 'done', 'active'])).toBe(83);
    expect(progressPercent(['done', 'done', 'done'])).toBe(100);
  });
});
