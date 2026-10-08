import { fhirBaseUrl, openmrsFetch } from '@openmrs/esm-framework';
import useSWR from 'swr';

export interface RemoteSearchedPatient {
  uuid: string;
  display?: string;
  /** Already at this facility (imported earlier): offered as "Open", not imported again. */
  alreadyLocal?: boolean;
  person?: {
    uuid?: string;
    display?: string;
    gender?: string;
    age?: number;
    birthdate?: string;
    birthdateEstimated?: boolean;
    dead?: boolean;
    preferredName?: {
      givenName?: string;
      middleName?: string;
      familyName?: string;
    };
  };
  identifiers?: Array<{
    identifier?: string;
    preferred?: boolean;
    identifierType?: {
      uuid?: string;
      name?: string;
    };
  }>;
}

/** The slice of a FHIR Patient the workspace callbacks are given; they read it as `fhir.Patient`. */
export interface FhirPatient {
  resourceType: 'Patient';
  id?: string;
  [key: string]: unknown;
}

const restUrl = '/ws/rest/v1/liberiaemr';
export const minimumQueryLength = 2;

const fetcher = (url: string) => openmrsFetch(url).then((response) => response.data);

/** Whether the server has a central URL configured; the UI hides itself when it has not. */
export function useRemoteSearchStatus() {
  const { data, error } = useSWR<{ enabled: boolean }>(`${restUrl}/remotesearch/status`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });

  return { status: data, error };
}

export function useRemotePatientSearch(query: string, shouldSearch: boolean, minLength = minimumQueryLength) {
  const trimmed = query?.trim() ?? '';
  const key =
    shouldSearch && trimmed.length >= minLength ? `${restUrl}/remotesearch?q=${encodeURIComponent(trimmed)}` : null;

  const { data, error, isLoading } = useSWR<{ results: Array<RemoteSearchedPatient> }>(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  return {
    results: data?.results ?? [],
    isLoading,
    error,
    hasSearched: Boolean(key) && !isLoading && !error,
  };
}

export interface ImportOutcome {
  localUuid: string;
  /** False when the patient was already here and only missing rows were added. */
  created?: boolean;
  /** "deferred": the history is fetched by its own call, {@link refreshRemoteHistory}. */
  history?: 'retrieved' | 'notRetrieved' | 'deferred';
}

/** Whether central answers and accepts this facility's credentials: the import's first step. */
export async function pingCentral(): Promise<void> {
  await openmrsFetch(`${restUrl}/remotesearch/ping`);
}

/**
 * Creates the patient shell only; the history is fetched next by {@link refreshRemoteHistory}, so
 * each stage can be shown as it happens. The server logs the import with its reason.
 *
 * @param reason the reason for access (ADR 0007 condition 3)
 */
export async function importRemotePatient(remoteUuid: string, reason: string): Promise<ImportOutcome> {
  const response = await openmrsFetch<ImportOutcome>(`${restUrl}/importpatient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { remoteUuid, reason, deferHistory: true },
  });

  return response.data;
}

export interface HistoryRefreshOutcome {
  attempt: 'ok' | 'error' | 'unreachable' | 'none';
  history: 'retrieved' | 'notRetrieved';
  status: string;
  /** How many other facilities the cached history now comes from. */
  facilityCount: number;
  fetchedAt: string | null;
}

/** Fetches the patient's history from other facilities into this facility's store, now. */
export async function refreshRemoteHistory(patientUuid: string, reason: string): Promise<HistoryRefreshOutcome> {
  const response = await openmrsFetch<HistoryRefreshOutcome>(`${restUrl}/remotehistory/local/${patientUuid}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { reason },
  });

  return response.data;
}

/**
 * The workspace callback (`onPatientSelected`) takes a FHIR patient, which consumers such as the
 * queue and appointment flows read. The import has just created the patient here, so fetch it;
 * fall back to a bare resource so a slow FHIR endpoint cannot strand a successful import.
 */
export async function fetchFhirPatient(patientUuid: string): Promise<FhirPatient> {
  try {
    const response = await openmrsFetch<FhirPatient>(`${fhirBaseUrl}/Patient/${patientUuid}`);
    return response.data;
  } catch {
    return { resourceType: 'Patient', id: patientUuid };
  }
}
