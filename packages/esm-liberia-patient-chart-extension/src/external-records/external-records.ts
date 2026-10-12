import type { Translate } from './format-as-of';

/** Read-only state of an imported patient's history from other facilities (mockups 6a–6f). */
export type ExternalRecordsStatus = 'fresh' | 'offline' | 'stale' | 'notRetrieved' | 'unavailableOffline' | 'empty';

/** `GET /ws/rest/v1/liberiaemr/remotehistory/local/{patientUuid}`. */
export interface LocalHistoryResponse {
  patientUuid: string;
  imported: boolean;
  status?: string;
  centralReachable?: boolean | null;
  fetchedAt?: string | null;
  ageSeconds?: number | null;
  sources?: Array<{
    sourceFacilityUuid: string | null;
    sourceFacilityName: string | null;
    fetchedAt?: string;
    bundle: { entry?: Array<{ resource?: FhirResource }> } | null;
  }>;
}

/** `POST /ws/rest/v1/liberiaemr/remotehistory/local/{patientUuid}/refresh`. */
export interface RefreshResponse {
  attempt: 'ok' | 'error' | 'unreachable' | 'none';
  history: 'retrieved' | 'notRetrieved';
  status: string;
  facilityCount: number;
  fetchedAt: string | null;
}

export interface Facility {
  uuid: string | null;
  /** Null when central couldn't attribute the records. */
  name: string | null;
}

interface Row {
  id: string;
  facility: Facility;
}

export interface ExternalAllergy extends Row {
  allergen: string;
  category?: string;
  criticality?: string;
  reactions: Array<string>;
  recordedDate?: string;
}

export interface ExternalCondition extends Row {
  condition: string;
  onsetDate?: string;
  recordedDate?: string;
}

export interface ExternalMedication extends Row {
  medication: string;
  dosage?: string;
  authoredOn?: string;
}

export interface ExternalImmunisation extends Row {
  vaccine: string;
  date?: string;
}

export interface ExternalProgrammeEnrolment extends Row {
  programme: string;
  active: boolean;
  enrolledOn?: string;
  completedOn?: string;
  currentStates: Array<string>;
}

export interface ExternalAncContact {
  facility: Facility;
  contactDate?: string;
  gestationalAgeWeeks?: number;
  nextContactDate?: string;
}

export interface ExternalEncounter extends Row {
  date?: string;
  type: string;
  location?: string;
}

export interface ExternalSections {
  allergies: Array<ExternalAllergy>;
  conditions: Array<ExternalCondition>;
  medications: Array<ExternalMedication>;
  immunisations: Array<ExternalImmunisation>;
  programmes: Array<ExternalProgrammeEnrolment>;
  lastAncContact: ExternalAncContact | null;
  /** Newest first. */
  encounters: Array<ExternalEncounter>;
}

export interface FacilitySummary extends Facility {
  /** Rows from this facility across all sections. */
  count: number;
}

interface FhirResource {
  resourceType?: string;
  id?: string;
  [key: string]: any;
}

export const ancSummaryTag = 'anc-contact-summary';
export const programmeStateExtension = 'https://liberiaemr.moh.gov.lr/fhir/StructureDefinition/programme-current-state';

const text = (codeable: any): string | undefined =>
  codeable?.text ?? codeable?.coding?.find((coding: any) => coding?.display)?.display ?? undefined;

const byDateDesc = (a?: string, b?: string) => (b ?? '').localeCompare(a ?? '');

/** Turns the cached bundles into the rows the card and dashboard show, each with its source facility. */
export function toSections(sources: LocalHistoryResponse['sources'] = []): ExternalSections {
  const sections: ExternalSections = {
    allergies: [],
    conditions: [],
    medications: [],
    immunisations: [],
    programmes: [],
    lastAncContact: null,
    encounters: [],
  };
  const ancByEncounter = new Map<string, ExternalAncContact>();

  (sources ?? []).forEach((source, sourceIndex) => {
    const facility: Facility = { uuid: source.sourceFacilityUuid ?? null, name: source.sourceFacilityName ?? null };
    (source.bundle?.entry ?? []).forEach(({ resource: r }, entryIndex) => {
      if (!r?.resourceType) return;
      const id = r.id ?? `${r.resourceType}-${sourceIndex}-${entryIndex}`;
      switch (r.resourceType) {
        case 'AllergyIntolerance':
          sections.allergies.push({
            id,
            facility,
            allergen: text(r.code) ?? '',
            category: r.category?.[0],
            criticality: r.criticality,
            reactions: (r.reaction?.[0]?.manifestation ?? []).map(text).filter(Boolean),
            recordedDate: r.recordedDate,
          });
          break;
        case 'Condition':
          sections.conditions.push({
            id,
            facility,
            condition: text(r.code) ?? '',
            onsetDate: r.onsetDateTime,
            recordedDate: r.recordedDate,
          });
          break;
        case 'MedicationRequest':
          sections.medications.push({
            id,
            facility,
            medication: text(r.medicationCodeableConcept) ?? '',
            dosage: r.dosageInstruction?.[0]?.text,
            authoredOn: r.authoredOn,
          });
          break;
        case 'Immunization':
          sections.immunisations.push({ id, facility, vaccine: text(r.vaccineCode) ?? '', date: r.occurrenceDateTime });
          break;
        case 'EpisodeOfCare':
          sections.programmes.push({
            id,
            facility,
            programme: text(r.type?.[0]) ?? '',
            active: r.status === 'active',
            enrolledOn: r.period?.start,
            completedOn: r.period?.end,
            currentStates: (r.extension ?? [])
              .filter((extension: any) => extension?.url === programmeStateExtension)
              .map((extension: any) => extension.valueString)
              .filter(Boolean),
          });
          break;
        case 'Encounter':
          sections.encounters.push({
            id,
            facility,
            date: r.period?.start,
            type: r.type?.[0]?.text ?? '',
            location: r.location?.[0]?.location?.display,
          });
          break;
        case 'Observation': {
          if (!r.meta?.tag?.some((tag: any) => tag?.code === ancSummaryTag)) break;
          const key = r.encounter?.reference ?? id;
          const contact = ancByEncounter.get(key) ?? { facility };
          contact.contactDate = contact.contactDate ?? r.effectiveDateTime;
          if (typeof r.valueQuantity?.value === 'number') contact.gestationalAgeWeeks = r.valueQuantity.value;
          if (r.valueDateTime) contact.nextContactDate = r.valueDateTime;
          ancByEncounter.set(key, contact);
          break;
        }
      }
    });
  });

  // Linked records can each carry a last ANC contact; the latest one is the patient's.
  sections.lastAncContact =
    [...ancByEncounter.values()].sort((a, b) => byDateDesc(a.contactDate, b.contactDate))[0] ?? null;
  sections.encounters.sort((a, b) => byDateDesc(a.date, b.date));
  return sections;
}

/** Each source facility with how many rows it contributed, for the facility filter. */
export function toFacilities(sections: ExternalSections): Array<FacilitySummary> {
  const counts = new Map<string, FacilitySummary>();
  const rows: Array<{ facility: Facility }> = [
    ...sections.allergies,
    ...sections.conditions,
    ...sections.medications,
    ...sections.immunisations,
    ...sections.programmes,
    ...sections.encounters,
    ...(sections.lastAncContact ? [sections.lastAncContact] : []),
  ];
  for (const { facility } of rows) {
    const key = facility.uuid ?? facility.name ?? '';
    const summary = counts.get(key) ?? { ...facility, count: 0 };
    summary.count++;
    counts.set(key, summary);
  }
  return [...counts.values()];
}

export function countRows(sections: ExternalSections): number {
  return toFacilities(sections).reduce((total, facility) => total + facility.count, 0);
}

const serverStatuses: Array<ExternalRecordsStatus> = [
  'fresh',
  'offline',
  'stale',
  'notRetrieved',
  'unavailableOffline',
];

/**
 * The status shown, from the server's answer and whether this request reached the server.
 *
 * @param response the last answer (SWR keeps it when a later request fails), or undefined
 * @param requestFailed the latest request to this facility's server failed (browser offline)
 */
export function toStatus(
  response: LocalHistoryResponse | undefined,
  rowCount: number,
  requestFailed: boolean,
): ExternalRecordsStatus | null {
  if (!response) {
    return requestFailed ? 'unavailableOffline' : null;
  }
  if (!response.imported) {
    return null;
  }
  if (requestFailed) {
    return response.fetchedAt ? 'offline' : 'unavailableOffline';
  }
  const status = serverStatuses.find((candidate) => candidate === response.status) ?? 'notRetrieved';
  // Central answered at some point, with nothing from other facilities (6f).
  if (response.fetchedAt && rowCount === 0 && (status === 'fresh' || status === 'stale' || status === 'offline')) {
    return 'empty';
  }
  return status;
}

export interface RefreshSnackbar {
  kind: 'success' | 'warning';
  title: string;
  subtitle: string;
}

/**
 * The snackbar after Refresh / Retry (mockups 3d, 3e).
 *
 * @param result the refresh answer, or null when the request itself failed
 * @param previousFetchedAt when the copy shown before Refresh was fetched, or null if there was none
 * @param asOf formats a fetch time, e.g. "2 Oct 2026, 08:14 (2 days ago)"
 */
export function refreshSnackbar(
  result: RefreshResponse | null,
  previousFetchedAt: string | null | undefined,
  asOf: (when: string) => string,
  t: Translate,
): RefreshSnackbar {
  if (result?.history === 'retrieved' && result.fetchedAt) {
    return {
      kind: 'success',
      title: t('externalRecordsRefreshed', 'External records refreshed'),
      subtitle: t('showingRecordsAsOf', 'Showing records as of {{asOf}}.', { asOf: asOf(result.fetchedAt) }),
    };
  }
  const copy = result?.fetchedAt ?? previousFetchedAt;
  return {
    kind: 'warning',
    title: t('couldNotRefresh', 'Could not refresh from central'),
    subtitle: copy
      ? t('stillShowingRecordsAsOf', 'Still showing records as of {{asOf}}.', { asOf: asOf(copy) })
      : t('historyRetrievedLater', 'History from other facilities will be retrieved later.'),
  };
}
