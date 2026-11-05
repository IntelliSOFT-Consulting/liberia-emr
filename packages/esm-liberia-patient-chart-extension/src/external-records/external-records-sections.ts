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
  /** Dashboard title (5a). */
  title: (t: Translate) => string;
  /** Patient Summary card title, when shorter (4a). */
  summaryTitle?: (t: Translate) => string;
  /** Lower-case name in "No … recorded at …". */
  noun: (t: Translate) => string;
  /** Shown after the title, e.g. what the encounter index leaves out. */
  note?: (t: Translate) => string;
  /** Last cell of every row on the dashboard, under an Actions column (5a encounter index). */
  rowNote?: (t: Translate) => string;
  rows: (sections: ExternalSections) => Array<T>;
  /** Dashboard columns. The Facility column is added by the table, not listed here. */
  columns: Array<SectionColumn<T>>;
  /** Patient Summary card columns, when they differ (4a). */
  summaryColumns?: Array<SectionColumn<T>>;
}

const date = (iso: string | undefined, formatDate: (iso: string) => string) => (iso ? formatDate(iso) : '');
const joined = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' · ');

/** One definition per section; card and dashboard both render from these. */
export const sectionDefinitions: Record<string, SectionDefinition> = {
  allergies: {
    id: 'allergies',
    title: (t) => t('allergiesAndIntolerances', 'Allergies and intolerances'),
    summaryTitle: (t) => t('allergies', 'Allergies'),
    noun: (t) => t('allergiesNoun', 'allergies'),
    rows: (sections) => sections.allergies,
    columns: [
      { key: 'allergen', header: (t) => t('allergen', 'Allergen'), value: (row) => row.allergen },
      {
        key: 'reaction',
        header: (t) => t('reactionSeverity', 'Reaction · severity'),
        value: (row) => joined(row.reactions.join(', '), row.criticality?.toLowerCase()),
      },
      {
        key: 'recorded',
        header: (t) => t('recorded', 'Recorded'),
        value: (row, formatDate) => date(row.recordedDate, formatDate),
      },
    ],
    summaryColumns: [
      { key: 'allergen', header: (t) => t('allergen', 'Allergen'), value: (row) => row.allergen },
      { key: 'severity', header: (t) => t('severity', 'Severity'), value: (row) => row.criticality ?? '' },
      { key: 'reaction', header: (t) => t('reaction', 'Reaction'), value: (row) => row.reactions.join(', ') },
    ],
  },
  conditions: {
    id: 'conditions',
    title: (t) => t('activeConditionsTitle', 'Active conditions'),
    summaryTitle: (t) => t('activeConditions', 'Active Conditions'),
    noun: (t) => t('activeConditionsNoun', 'active conditions'),
    rows: (sections) => sections.conditions,
    columns: [
      { key: 'condition', header: (t) => t('condition', 'Condition'), value: (row) => row.condition },
      { key: 'onset', header: (t) => t('onset', 'Onset'), value: (row, formatDate) => date(row.onsetDate, formatDate) },
    ],
    summaryColumns: [
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
  medications: {
    id: 'medications',
    title: (t) => t('currentMedications', 'Current medications'),
    noun: (t) => t('currentMedicationsNoun', 'current medications'),
    rows: (sections) => sections.medications,
    columns: [
      {
        key: 'drug',
        header: (t) => t('drugDoseFrequency', 'Drug · dose · frequency'),
        value: (row) => joined(row.medication, row.dosage),
      },
      {
        key: 'started',
        header: (t) => t('started', 'Started'),
        value: (row, formatDate) => date(row.authoredOn, formatDate),
      },
    ],
  },
  immunisations: {
    id: 'immunisations',
    title: (t) => t('immunisations', 'Immunisations'),
    noun: (t) => t('immunisationsNoun', 'immunisations'),
    rows: (sections) => sections.immunisations,
    columns: [
      { key: 'vaccine', header: (t) => t('vaccine', 'Vaccine'), value: (row) => row.vaccine },
      { key: 'dose', header: (t) => t('dose', 'Dose'), value: (row) => (row.dose ? String(row.dose) : '') },
      { key: 'date', header: (t) => t('date', 'Date'), value: (row, formatDate) => date(row.date, formatDate) },
    ],
  },
  programmes: {
    id: 'programmes',
    title: (t) => t('programmeEnrolments', 'Programme enrolments'),
    noun: (t) => t('programmeEnrolmentsNoun', 'programme enrolments'),
    rows: (sections) => sections.programmes,
    columns: [
      { key: 'programme', header: (t) => t('programme', 'Programme'), value: (row) => row.programme },
      {
        key: 'state',
        header: (t) => t('currentState', 'Current state'),
        value: (row) => row.currentStates.join(', ') || (row.active ? 'Active' : 'Completed'),
      },
      {
        key: 'enrolled',
        header: (t) => t('enrolled', 'Enrolled'),
        value: (row, formatDate) => date(row.enrolledOn, formatDate),
      },
    ],
  },
  encounters: {
    id: 'encounters',
    title: (t) => t('encounterIndex', 'Encounter index'),
    noun: (t) => t('encountersNoun', 'encounters'),
    note: (t) =>
      t('encounterIndexNote', 'Date, type and facility only. Observations are not shared between facilities.'),
    rowNote: (t) => t('contactFacilityForDetails', 'Contact the facility for details'),
    rows: (sections) => sections.encounters,
    columns: [
      { key: 'date', header: (t) => t('date', 'Date'), value: (row, formatDate) => date(row.date, formatDate) },
      { key: 'type', header: (t) => t('encounterType', 'Encounter type'), value: (row) => row.type },
    ],
  },
};

/** Sections a card or dashboard can list, in dashboard order (5a). */
export const sectionIds = Object.keys(sectionDefinitions);

/** "28 weeks + 3 days" from gestational age in (possibly fractional) weeks. */
export function formatGestationalAge(weeks: number | undefined, t: Translate): string {
  if (typeof weeks !== 'number' || weeks < 0) {
    return '';
  }
  let whole = Math.floor(weeks);
  let days = Math.round((weeks - whole) * 7);
  if (days === 7) {
    whole += 1;
    days = 0;
  }
  const weekText = t('gaWeeks', '{{count}} weeks', { count: whole, defaultValue_one: '{{count}} week' });
  if (days === 0) {
    return weekText;
  }
  return `${weekText} + ${t('gaDays', '{{count}} days', { count: days, defaultValue_one: '{{count}} day' })}`;
}

/** Dashboard sections in order (5a): the section tables plus the Last ANC contact card. */
export const ancContactSectionId = 'ancContact';

/** The bar shown above the data, or the empty state shown instead of it (mockups 6a–6f). */
export type StatusDisplay =
  | { type: 'bar'; kind: 'info' | 'warning'; title: string; subtitle: string; action: string }
  | { type: 'empty'; title: string; body: string; action: string };

/** @param detailed the dashboard's longer empty-state text (5a) rather than the card's (4a) */
export function statusDisplay(
  status: ExternalRecordsStatus,
  asOf: string,
  t: Translate,
  detailed = false,
): StatusDisplay {
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
        body: detailed
          ? t(
              'historyRetrievedLaterDetailed',
              'History from other facilities will be retrieved later. It is retried automatically the next time this chart is opened.',
            )
          : t('historyRetrievedLater', 'History from other facilities will be retrieved later.'),
        action: t('retry', 'Retry'),
      };
    case 'unavailableOffline':
      return {
        type: 'empty',
        title: t('historyUnavailableOffline', 'History from other facilities unavailable offline'),
        body: detailed
          ? t(
              'historyWhenOnlineDetailed',
              'No copy has been retrieved yet. It will be retrieved when this facility can reach central again.',
            )
          : t('historyWhenOnline', 'It will be retrieved when this facility can reach central again.'),
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
