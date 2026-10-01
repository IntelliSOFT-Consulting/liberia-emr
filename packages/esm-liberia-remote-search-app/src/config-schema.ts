import { Type, validator } from '@openmrs/esm-framework';

export const configSchema = {
  enabled: {
    _type: Type.Boolean,
    _default: true,
    _description: 'Master switch. False hides all remote search UI without needing a redeploy.',
  },
  remoteSearchLabel: {
    _type: Type.String,
    _default: 'Remote Search',
  },
  emptyStateHint: {
    _type: Type.String,
    _default: "Can't find the patient you're looking for? Try Remote Search",
  },
  importButtonLabel: {
    _type: Type.String,
    _default: 'Import & Open',
  },
  defaultToggleOn: {
    _type: Type.Boolean,
    _default: false,
    _description: 'Whether the toggle is ON by default. Users can always flip it.',
  },
  rememberToggleState: {
    _type: Type.Boolean,
    _default: false,
    _description:
      'Persist the toggle position in localStorage across page loads. Off by default, so every page load starts from defaultToggleOn.',
  },
  resetToggleOnClose: {
    _type: Type.Boolean,
    _default: true,
    _description:
      'Return the toggle to defaultToggleOn when the search is closed (dropdown dismissed, search page or workspace left), so each new search starts with Remote Search off until the user turns it on.',
  },
  minimumQueryLength: {
    _type: Type.Number,
    _default: 2,
    _description:
      'How many characters must be typed before the central server is searched. The server itself never searches on fewer than 2.',
    // Below the server minimum a search would always come back empty.
    _validators: [
      validator(
        (value: number) => Number.isInteger(value) && value >= 2,
        'minimumQueryLength must be a whole number of 2 or more',
      ),
    ],
  },
  // The messages below are shown to clinicians. Leave one empty to use the built-in, translated
  // text; set it to replace that text. {{query}}, {{count}} and {{label}} are filled in where noted.
  searchingMessage: {
    _type: Type.String,
    _default: '',
    _description: 'Shown while the central server is being searched. Built-in: "Searching the central server...".',
  },
  noResultsMessage: {
    _type: Type.String,
    _default: '',
    _description:
      'Shown when nothing on the central server matches. {{query}} is the search text. Built-in: "No patients on the central server match \"{{query}}\".".',
  },
  alreadyLocalMessage: {
    _type: Type.String,
    _default: '',
    _description:
      'Shown when every central match is already registered at this facility. {{count}} is how many, {{query}} the search text. Built-in: "{{count}} matching patient(s) on the central server are already at this facility. See the local results.".',
  },
  minCharactersMessage: {
    _type: Type.String,
    _default: '',
    _description:
      'Shown while too few characters are typed. {{count}} is the minimum. Built-in: "Enter at least {{count}} characters to search the central server.".',
  },
  unavailableTitle: {
    _type: Type.String,
    _default: '',
    _description:
      'Title of the warning shown when the central server cannot be searched. Built-in: "Remote Search is unavailable".',
  },
  unavailableMessage: {
    _type: Type.String,
    _default: '',
    _description: 'Body of that warning. Built-in: "The central server could not be reached. Try again shortly.".',
  },
  offlineMessage: {
    _type: Type.String,
    _default: '',
    _description:
      'Shown instead of the toggle when the browser is offline. Built-in: "Remote Search is unavailable while offline".',
  },
  importSuccessMessage: {
    _type: Type.String,
    _default: '',
    _description: 'Notification shown after a patient is imported. Built-in: "Patient imported successfully".',
  },
};
