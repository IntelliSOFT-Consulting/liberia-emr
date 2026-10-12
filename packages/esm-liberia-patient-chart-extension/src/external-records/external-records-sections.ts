import type { ExternalRecordsStatus, ExternalSections, Facility } from './external-records';
import type { Translate } from './format-as-of';

/** A row any section table can show: every external row carries its source facility. */
export interface ExternalRow {
  id: string;
  facility: Facility;
}

export interface SectionColumn<T extends ExternalRow> {
  key: string;
  header: (t: Translate) => string;
  /** Plain text, so the same definition serves the table, filters and tests. */
  value: (row: T, formatDate: (iso: string) => string) => string;
}

export interface SectionDefinition<T extends ExternalRow = any> {
  id: string;
  title: (t: Translate) => string;
  rows: (sections: ExternalSections) => Array<T>;
  /** The Facility column is added by the table, not listed here. */
  columns: Array<SectionColumn<T>>;
}

const date = (iso: string | undefined, formatDate: (iso: string) => string) => (iso ? formatDate(iso) : '');

/** One definition per section; card and dashboard both render from these. */
export const sectionDefinitions: Record<string, SectionDefinition> = {
  allergies: {
    id: 'allergies',
    title: (t) => t('allergies', 'Allergies'),
    rows: (sections) => sections.allergies,
    columns: [
      { key: 'allergen', header: (t) => t('allergen', 'Allergen'), value: (row) => row.allergen },
      { key: 'severity', header: (t) => t('severity', 'Severity'), value: (row) => row.criticality ?? '' },
      { key: 'reaction', header: (t) => t('reaction', 'Reaction'), value: (row) => row.reactions.join(', ') },
    ],
  },
  conditions: {
    id: 'conditions',
    title: (t) => t('activeConditions', 'Active Conditions'),
    rows: (sections) => sections.conditions,
    columns: [
      { key: 'condition', header: (t) => t('condition', 'Condition'), value: (row) => row.condition },
      {
        key: 'onset',
        header: (t) => t('dateOfOnset', 'Date of onset'),
        value: (row, formatDate) => date(row.onsetDate, formatDate),
      },
      // Central sends active conditions only.
      { key: 'status', header: (t) => t('status', 'Status'), value: () => 'Active' },
    ],
  },
};

export const sectionIds = Object.keys(sectionDefinitions);

/** The bar shown above the data, or the empty state shown instead of it (mockups 6a–6f). */
export type StatusDisplay =
  | { type: 'bar'; kind: 'info' | 'warning'; title: string; subtitle: string; action: string }
  | { type: 'empty'; title: string; body: string; action: string };

export function statusDisplay(status: ExternalRecordsStatus, asOf: string, t: Translate): StatusDisplay {
  switch (status) {
    case 'fresh':
      return {
        type: 'bar',
        kind: 'info',
        title: t('asOf', 'As of {{asOf}}', { asOf }),
        subtitle: t('retrievedFromCentral', '· Retrieved from Central Instance'),
        action: t('refresh', 'Refresh'),
      };
    case 'offline':
      return {
        type: 'bar',
        kind: 'warning',
        title: t('offline', 'Offline'),
        subtitle: t('showingRecordsAsOfShort', '— showing records as of {{asOf}}', { asOf }),
        action: t('retry', 'Retry'),
      };
    case 'stale':
      return {
        type: 'bar',
        kind: 'warning',
        title: t('couldNotRefresh', 'Could not refresh from central'),
        subtitle: t('showingRecordsAsOfLong', '— Showing records as of {{asOf}}', { asOf }),
        action: t('retryRefresh', 'Retry Refresh'),
      };
    case 'notRetrieved':
      return {
        type: 'empty',
        title: t('historyNotRetrieved', 'History not yet retrieved'),
        body: t('historyRetrievedLater', 'History from other facilities will be retrieved later.'),
        action: t('retry', 'Retry'),
      };
    case 'unavailableOffline':
      return {
        type: 'empty',
        title: t('historyUnavailableOffline', 'History from other facilities unavailable offline'),
        body: t('historyWhenOnline', 'It will be retrieved when this facility can reach central again.'),
        action: t('retry', 'Retry'),
      };
    case 'empty':
      return {
        type: 'empty',
        title: t('noExternalRecords', 'No records from other facilities'),
        body: t('noExternalRecordsBody', 'Central holds no records for this patient from other facilities.'),
        action: t('retry', 'Retry'),
      };
  }
}
