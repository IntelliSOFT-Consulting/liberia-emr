import { fhirBaseUrl, openmrsFetch } from '@openmrs/esm-framework';
import useSWR from 'swr';

export interface RemoteSearchedPatient {
  uuid: string;
  display?: string;
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

  const { data, error, isLoading } = useSWR<{
    results: Array<RemoteSearchedPatient>;
    alreadyLocalCount?: number;
  }>(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  return {
    results: data?.results ?? [],
    alreadyLocalCount: data?.alreadyLocalCount ?? 0,
    isLoading,
    error,
    hasSearched: Boolean(key) && !isLoading && !error,
  };
}

export async function importRemotePatient(remoteUuid: string): Promise<{ localUuid: string }> {
  const response = await openmrsFetch(`${restUrl}/importpatient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { remoteUuid },
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
