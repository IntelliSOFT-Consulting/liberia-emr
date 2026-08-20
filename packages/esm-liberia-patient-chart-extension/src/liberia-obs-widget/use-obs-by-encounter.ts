import useSWR from 'swr';
import { openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import type { ConfigObject } from '../config-schema';

/** Shape of a single obs returned by the REST custom rep */
export interface ObsRep {
  uuid: string;
  concept: { uuid: string; display: string };
  /** Numeric / text value */
  value: string | number | { uuid: string; display: string };
  display: string;
}

/** One encounter row as returned by the REST custom rep */
export interface EncounterRep {
  uuid: string;
  encounterDatetime: string;
  obs: ObsRep[];
}

interface UseObsByEncounterResult {
  encounters: EncounterRep[];
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<any>;
}

/**
 * Fetches encounters for the given patient, optionally filtered to the
 * encounter types listed in config. Returns them sorted newest-first (or
 * oldest-first if `config.oldestFirst` is true).
 *
 * Uses the OpenMRS REST v1 API directly so that this package has no compile-
 * time dependency on upstream esm-generic-patient-widgets-app internals.
 */
export function useObsByEncounter(patientUuid: string, isPolling: boolean = false): UseObsByEncounterResult {
  const config = useConfig<ConfigObject>();

  // Build query string — multiple encounterType params are OR-ed by the REST layer
  const encounterTypeParams = config.encounterTypes
    ?.map((uuid) => `encounterType=${uuid}`)
    .join('&');

  const queryString = [
    `patient=${patientUuid}`,
    encounterTypeParams,
    'v=custom:(uuid,encounterDatetime,obs:(uuid,concept:(uuid,display),value,display))',
  ]
    .filter(Boolean)
    .join('&');

  const url = `${restBaseUrl}/encounter?${queryString}`;

  const fetcher = (fetchUrl: string) => {
    if (!isPolling) return openmrsFetch(fetchUrl);
    const delimiter = fetchUrl.includes('?') ? '&' : '?';
    return openmrsFetch(`${fetchUrl}${delimiter}_=${Date.now()}`);
  };

  const { data, error, isLoading, mutate } = useSWR<{ data: { results: EncounterRep[] } }, Error>(
    patientUuid ? url : null,
    fetcher,
    { refreshInterval: isPolling ? 1000 : 0 }
  );

  const encounters = [...(data?.data?.results ?? [])].sort((a, b) => {
    const diff = new Date(b.encounterDatetime).getTime() - new Date(a.encounterDatetime).getTime();
    return config.oldestFirst ? -diff : diff;
  });

  return { encounters, isLoading, error, mutate };
}

/**
 * Extracts the display-ready string value from an obs REST response.
 * Handles Numeric, Text, and Coded obs uniformly.
 */
export function getObsDisplayValue(obs: ObsRep | undefined): string {
  if (!obs) return '--';
  if (typeof obs.value === 'object' && obs.value !== null) {
    return (obs.value as { display: string }).display ?? '--';
  }
  return String(obs.value);
}
