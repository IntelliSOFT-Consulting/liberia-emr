import { getGlobalStore } from '@openmrs/esm-framework';

/**
 * Registers a helper on the React form engine expression registry.
 *
 * This is the same global store and mutation that
 * `registerExpressionHelper()` in `@openmrs/esm-form-engine-lib` uses
 * (`FormsStore` = `forms-engine-store`). Going through the shared framework
 * store avoids bundling a second copy of the form-engine library, whose
 * private registry the running form engine would never see.
 */
export function registerFormEngineExpressionHelper(name: string, fn: Function) {
  const store = getGlobalStore('forms-engine-store', {
    controls: [],
    postSubmissionActions: [],
    expressionHelpers: {},
    fieldValidators: [],
    fieldValueAdapters: [],
    dataSources: [],
    formSchemaTransformers: [],
  });
  const state = store.getState() as { expressionHelpers?: Record<string, Function> };
  if (!state.expressionHelpers) {
    state.expressionHelpers = {};
  }
  state.expressionHelpers[name] = fn;
}
