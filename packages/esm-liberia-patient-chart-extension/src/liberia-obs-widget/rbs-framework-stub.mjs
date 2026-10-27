export {
  compile,
  evaluateAsType,
  evaluateAsTypeAsync,
  extractVariableNames,
} from '@openmrs/esm-expression-evaluator';

const stores = new Map();

export function getGlobalStore(key, initial = {}) {
  let store = stores.get(key);
  if (!store) {
    const state = initial;
    store = {
      getState: () => state,
      setState: (partial) => Object.assign(state, partial),
      subscribe: () => () => {},
    };
    stores.set(key, store);
  }
  return store;
}

export function formatDate(value) {
  return value == null ? '' : String(value);
}
export function parseDate(value) {
  return value;
}
export function toOmrsIsoString(value) {
  return value == null ? '' : String(value);
}
export function attachmentUrl() {
  return '';
}
export function getAttachmentByUuid() {
  return Promise.resolve({ data: null });
}
export function showSnackbar() {}
export function showModal() {}
export function launchWorkspace2() {}
export function attach() {}
export function createErrorHandler() {
  return () => {};
}
export function translateFrom(_module, _key, fallback) {
  return fallback ?? '';
}
export function openmrsFetch() {
  return Promise.resolve({});
}
export function useConfig() {
  return {};
}
export function useLayoutType() {
  return 'small-desktop';
}
export function usePatient() {
  return { patient: null, isLoading: false };
}
export function useSession() {
  return {};
}
export function OpenmrsDatePicker() {
  return null;
}
export function ExtensionSlot() {
  return null;
}
export function ChevronDownIcon() {
  return null;
}
export function ChevronUpIcon() {
  return null;
}
export const fhirBaseUrl = '/ws/fhir2/R4';
export const restBaseUrl = '/ws/rest/v1';
