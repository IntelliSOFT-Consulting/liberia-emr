import { Type, validators } from '@openmrs/esm-framework';

/**
 * Generic, programme-agnostic configuration schema.
 *
 * All clinical content — concepts, encounter types, the form to launch, display
 * mode — is supplied at runtime via content-package JSON config. The widget
 * itself contains no TB-, ANC-, or Partograph-specific defaults.
 */
export const configSchema = {
  title: {
    _type: Type.String,
    _default: 'Observations',
    _description: 'Widget header title. Can also be a translation key.',
  },
  formUuid: {
    _type: Type.String,
    _default: '',
    _description:
      'UUID of the AMPATH form to open when the user clicks "Add" or "Edit". ' +
      'The form is launched inside the standard patient-form-entry-workspace.',
  },
  encounterTypes: {
    _type: Type.Array,
    _elements: { _type: Type.String },
    _default: [],
    _description: 'Only show encounters that belong to one of these encounter type UUIDs.',
  },
  displayMode: {
    _type: Type.String,
    _default: 'table',
    _validators: [validators.oneOf(['table', 'graph', 'switchable'])],
    _description:
      '"table" = table view only | ' +
      '"graph" = graph view only | ' +
      '"switchable" = show a toggle so the user can switch between both.',
  },
  data: {
    _type: Type.Array,
    _elements: {
      _type: Type.Object,
      concept: {
        _type: Type.ConceptUuid,
        _description: 'Concept UUID to display as a column (table) or series (graph).',
      },
      label: {
        _type: Type.String,
        _default: '',
        _description: 'Column/row label. Defaults to the concept display name when empty.',
      },
    },
    _default: [],
    _description: 'Ordered list of concepts to display. Each entry becomes one column in table mode.',
  },
  maxEncounters: {
    _type: Type.Number,
    _default: 5,
    _description: 'Number of encounters shown per page.',
  },
  oldestFirst: {
    _type: Type.Boolean,
    _default: false,
    _description: 'Sort encounters oldest-to-newest. Defaults to newest first.',
  },
  fullWidth: {
    _type: Type.Boolean,
    _default: false,
    _description: 'If true, the widget spans the entire width of the dashboard grid.',
  },
  showAddButton: {
    _type: Type.Boolean,
    _default: true,
    _description: 'If true, displays the "Add" button to launch the form.',
  },
};

export interface ConfigObject {
  title: string;
  formUuid: string;
  encounterTypes: string[];
  displayMode: 'table' | 'graph' | 'switchable';
  data: Array<{ concept: string; label: string }>;
  maxEncounters: number;
  oldestFirst: boolean;
  fullWidth: boolean;
  showAddButton: boolean;
}
