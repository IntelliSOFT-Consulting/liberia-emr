const stubUrl = 'form-engine-framework-stub:module';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@openmrs/esm-framework' || specifier.startsWith('@openmrs/esm-framework/')) {
    return { url: stubUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === stubUrl) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        export function formatDate(value) { return value == null ? '' : String(value); }
        export function parseDate(value) { return value; }
        export function attachmentUrl() { return ''; }
        export function getAttachmentByUuid() { return Promise.resolve({ data: null }); }
        export function showSnackbar() {}
        export function createErrorHandler() { return () => {}; }
        export const fhirBaseUrl = '/ws/fhir2/R4';
        export const restBaseUrl = '/ws/rest/v1';
        export function openmrsFetch() { return Promise.resolve({}); }
        export function useConfig() { return {}; }
      `,
    };
  }
  return nextLoad(url, context);
}
