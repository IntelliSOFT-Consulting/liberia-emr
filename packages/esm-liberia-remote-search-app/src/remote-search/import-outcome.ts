import { type ImportResult } from './run-import';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export interface OutcomeSnackbar {
  kind: 'success' | 'warning';
  title: string;
  subtitle: string;
}

/**
 * The notification shown on the chart once an import has finished (mockups 3a, 3b). A warning,
 * not a success, when the history could not be copied: the record opened, but its history is
 * missing. A failed import uses the existing error snackbar instead.
 *
 * @param title the success title, which the deployment can reword (`importSuccessMessage`)
 */
export function importOutcomeSnackbar(result: ImportResult, title: string, t: Translate): OutcomeSnackbar {
  if (result.history !== 'retrieved') {
    return {
      kind: 'warning',
      title,
      subtitle: t('historyRetrievedLater', 'History from other facilities will be retrieved later.'),
    };
  }
  if (result.facilityCount === 0) {
    return {
      kind: 'success',
      title,
      subtitle: t('noExternalRecords', 'No records from other facilities'),
    };
  }
  return {
    kind: 'success',
    title,
    subtitle: t('externalRecordsCopied', 'Records from {{count}} other facilities are in External records.', {
      count: result.facilityCount,
      defaultValue_one: 'Records from {{count}} other facility are in External records.',
    }),
  };
}
