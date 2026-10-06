import { useConfig } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';

type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match));
}

/**
 * Text for the states the UI can be in. Each can be replaced from the app's config (so a
 * deployment can word them without a rebuild); when the config leaves it empty the built-in,
 * translated text is used.
 */
export function useRemoteSearchMessages() {
  const { t } = useTranslation();
  const config = useConfig();

  return (configKey: string, translationKey: string, fallback: string, vars?: Vars): string => {
    const custom = typeof config?.[configKey] === 'string' ? config[configKey].trim() : '';
    return custom ? fill(custom, vars) : t(translationKey, fallback, vars);
  };
}
