import { getGlobalStore } from '@openmrs/esm-framework';
import { vitaminAEncounterUuidFromWorkspace } from './vitamin-a-supplementation';

/** Form-engine helper. Encounter being edited, or '' when this is a new encounter. */
export function vitaminAEditingEncounterUuid(): string {
  try {
    const state = getGlobalStore('workspace2')?.getState();
    return vitaminAEncounterUuidFromWorkspace(state);
  } catch {
    return '';
  }
}
