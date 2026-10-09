import { createGlobalStore } from '@openmrs/esm-framework';
import { importRemotePatient, pingCentral, refreshRemoteHistory } from './import-patient.resource';

export type StepState = 'pending' | 'active' | 'done';

/** The three steps of the progress dialog (mockup 2c), each one real request. */
export type ImportSteps = [connecting: StepState, fetching: StepState, importing: StepState];

export const initialSteps: ImportSteps = ['pending', 'pending', 'pending'];

/**
 * Shared with the progress dialog, which the modal system renders in its own React root.
 */
export const importProgressStore = createGlobalStore<{ steps: ImportSteps }>('liberiaImportProgress', {
  steps: initialSteps,
});

export interface ImportResult {
  localUuid: string;
  /** The history was copied into this facility's store, or will be retrieved later. */
  history: 'retrieved' | 'notRetrieved';
  /** How many other facilities the history comes from; 0 when not retrieved. */
  facilityCount: number;
}

/** How far along the bar is: each finished step a third, the running one half of its third. */
export function progressPercent(steps: ImportSteps): number {
  const done = steps.filter((step) => step === 'done').length;
  const active = steps.some((step) => step === 'active') ? 0.5 : 0;
  return Math.round(((done + active) / steps.length) * 100);
}

/**
 * Imports in three calls so each step of the dialog follows its own request:
 *  1. Connecting to National Registry: central answers and accepts this facility's credentials.
 *  2. Fetching Patient Record: the patient shell is created (and the access logged with its reason).
 *  3. Importing to local system: the history from other facilities is copied into the local store.
 *
 * A failure in step 1 or 2 rejects: nothing usable was imported. A failure in step 3 does not: the
 * patient is here, and the history is retrieved later (the chart, or the next import, retries).
 */
export async function runImport(
  remoteUuid: string,
  reason: string,
  onSteps: (steps: ImportSteps) => void,
): Promise<ImportResult> {
  const steps: ImportSteps = [...initialSteps];
  const advance = (index: number, state: StepState) => {
    steps[index] = state;
    onSteps([...steps]);
  };

  advance(0, 'active');
  await pingCentral();
  advance(0, 'done');

  advance(1, 'active');
  const { localUuid } = await importRemotePatient(remoteUuid, reason);
  advance(1, 'done');

  advance(2, 'active');
  let result: ImportResult;
  try {
    const outcome = await refreshRemoteHistory(localUuid, reason);
    result = {
      localUuid,
      history: outcome.history === 'retrieved' ? 'retrieved' : 'notRetrieved',
      facilityCount: outcome.history === 'retrieved' ? (outcome.facilityCount ?? 0) : 0,
    };
  } catch {
    result = { localUuid, history: 'notRetrieved', facilityCount: 0 };
  }
  advance(2, 'done');
  return result;
}
