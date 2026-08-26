import useSWR from 'swr';
import { openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import type { EPartographConfig } from '../config-schema';

/** Shape of a single obs from the REST custom representation. */
export interface ObsRep {
  uuid: string;
  concept: { uuid: string; display: string };
  value: string | number | { uuid: string; display: string };
  display: string;
}

/** One partograph encounter row. */
export interface PartographEncounter {
  uuid: string;
  encounterDatetime: string;
  obs: ObsRep[];
}

interface UsePartographEncountersResult {
  /** All encounters, sorted oldest-first (earliest record = index 0). */
  encounters: PartographEncounter[];
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<any>;
}

/**
 * Fetches all encounters of the partograph encounter type for a patient.
 * Returns them sorted oldest-first so that the WHO alert/action line
 * calculation can correctly identify T₀ (the earliest recorded ≥4 cm dilation).
 */
export function usePartographEncounters(patientUuid: string): UsePartographEncountersResult {
  const config = useConfig<EPartographConfig>();

  const queryString = [
    `patient=${patientUuid}`,
    config.encounterTypeUuid ? `encounterType=${config.encounterTypeUuid}` : '',
    'v=custom:(uuid,encounterDatetime,obs:(uuid,concept:(uuid,display),value,display))',
    'limit=200',
  ]
    .filter(Boolean)
    .join('&');

  const url = `${restBaseUrl}/encounter?${queryString}`;

  const { data, error, isLoading, mutate } = useSWR<{ data: { results: PartographEncounter[] } }, Error>(
    patientUuid && config.encounterTypeUuid ? url : null,
    (fetchUrl: string) => openmrsFetch(`${fetchUrl}&_=${Date.now()}`),
  );

  // Sort oldest-first so index 0 is the very first partograph entry (needed for T₀).
  const encounters = [...(data?.data?.results ?? [])].sort(
    (a, b) => new Date(a.encounterDatetime).getTime() - new Date(b.encounterDatetime).getTime(),
  );

  return { encounters, isLoading, error, mutate };
}

/**
 * Extracts a numeric value from an obs REST response.
 * Returns `null` if the value cannot be parsed as a finite number.
 */
export function getNumericObsValue(obs: ObsRep | undefined): number | null {
  if (!obs) return null;
  const raw = typeof obs.value === 'object' && obs.value !== null ? (obs.value as { display: string }).display : obs.value;
  const num = parseFloat(String(raw));
  return Number.isFinite(num) ? num : null;
}

/**
 * Extracts a display-ready string value from an obs REST response.
 * Handles Numeric, Text, and Coded obs uniformly.
 */
export function getObsDisplayValue(obs: ObsRep | undefined): string {
  if (!obs) return '--';
  if (typeof obs.value === 'object' && obs.value !== null) {
    return (obs.value as { display: string }).display ?? '--';
  }
  return String(obs.value);
}

/**
 * For a given encounter, finds the obs matching conceptUuid and returns it.
 */
export function findObs(encounter: PartographEncounter, conceptUuid: string): ObsRep | undefined {
  return encounter.obs.find((o) => o.concept.uuid === conceptUuid);
}
