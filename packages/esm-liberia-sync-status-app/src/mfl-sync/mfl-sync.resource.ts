import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import {
  type MflConfigUpdate,
  type MflConnectionTest,
  type MflError,
  type MflItemAction,
  type MflRun,
  type MflRunItemPage,
  type MflRunPage,
  type MflStatus,
} from './mfl-sync.types';

export const mflBaseUrl = `${restBaseUrl}/liberiaemr/mfl`;

export const runsPageSize = 20;
export const itemsPageSize = 50;

/** What openmrsFetch throws: an Error carrying the response and its parsed body. */
export type MflFetchError = Error & { response?: { status?: number }; responseBody?: MflError };

/** Polled quickly while a run is in progress, so its counts and the history catch up on their own. */
const idleRefresh = 60_000;
const runningRefresh = 5_000;

export function useMflStatus() {
  const { data, error, isLoading, mutate } = useSWR<{ data: MflStatus }, MflFetchError>(
    `${mflBaseUrl}/status`,
    openmrsFetch,
    { refreshInterval: (latest) => (latest?.data?.running ? runningRefresh : idleRefresh) },
  );
  return { status: data?.data, error, isLoading, mutate };
}

export function useMflRuns(startIndex: number, running: boolean) {
  const { data, error, isLoading, mutate } = useSWR<{ data: MflRunPage }, MflFetchError>(
    `${mflBaseUrl}/runs?startIndex=${startIndex}&limit=${runsPageSize}`,
    openmrsFetch,
    { refreshInterval: running ? runningRefresh : idleRefresh },
  );
  return { runs: data?.data, error, isLoading, mutate };
}

export function useMflRun(id: number | null) {
  const { data, error, isLoading } = useSWR<{ data: MflRun }, MflFetchError>(
    id === null ? null : `${mflBaseUrl}/runs/${id}`,
    openmrsFetch,
    { refreshInterval: (latest) => (latest?.data?.status === 'RUNNING' ? runningRefresh : 0) },
  );
  return { run: data?.data, error, isLoading };
}

export function useMflRunItems(id: number | null, action: MflItemAction | null, startIndex: number) {
  const filter = action ? `&action=${action}` : '';
  const { data, error, isLoading } = useSWR<{ data: MflRunItemPage }, MflFetchError>(
    id === null ? null : `${mflBaseUrl}/runs/${id}/items?startIndex=${startIndex}&limit=${itemsPageSize}${filter}`,
    openmrsFetch,
  );
  return { items: data?.data, error, isLoading };
}

export function updateMflConfig(update: MflConfigUpdate) {
  return openmrsFetch<MflStatus>(`${mflBaseUrl}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: update,
  });
}

export function testMflConnection() {
  return openmrsFetch<MflConnectionTest>(`${mflBaseUrl}/test-connection`, { method: 'POST' });
}

export function startMflRun(dryRun: boolean) {
  return openmrsFetch<MflRun>(`${mflBaseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { dryRun },
  });
}

export function statusOf(error: unknown): number | undefined {
  return (error as MflFetchError)?.response?.status;
}

/** The server's own message, which the contract guarantees never carries a credential. */
export function messageOf(error: unknown): string | undefined {
  return (error as MflFetchError)?.responseBody?.error;
}

/** The same rules PUT /config applies, checked before the round trip. */
export function isValidUrl(url: string) {
  const trimmed = url.trim();
  return /^https:\/\/[^\s/]+/.test(trimmed) && !/\/api\/?$/.test(trimmed);
}

export function isValidTime(time: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim());
}
