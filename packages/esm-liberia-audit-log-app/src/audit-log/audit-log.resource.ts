import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/**
 * The audit log endpoint in modules/liberiaemr (AuditLogController). Every call needs Get Audit
 * Logs; the server answers 403 without it and 503 where the auditlog module is not running.
 */
export const baseUrl = `${restBaseUrl}/liberiaemr/auditlog`;

export type AuditAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface AuditUser {
  uuid: string;
  username: string | null;
  systemId: string | null;
}

export interface AuditEntry {
  uuid: string;
  dateCreated: string;
  action: AuditAction;
  type: string;
  typeName: string;
  identifier: string;
  user: AuditUser | null;
  parentUuid: string | null;
  hasValues: boolean;
  childCount?: number;
}

/**
 * A recorded value: text, a list (a collection's members), a map (a user's properties, say) or
 * nothing.
 */
export type AuditValue = string | number | boolean | Array<unknown> | Record<string, unknown> | null;

export interface AuditChange {
  property: string;
  previous: AuditValue;
  current: AuditValue;
  redacted: boolean;
}

export interface AuditProperty {
  property: string;
  value: AuditValue;
  redacted: boolean;
}

export interface AuditEntryDetail extends AuditEntry {
  changes?: Array<AuditChange>;
  lastState?: Array<AuditProperty>;
  children?: Array<AuditEntryDetail>;
}

export interface AuditPage {
  totalCount: number;
  startIndex: number;
  limit: number;
  results: Array<AuditEntry>;
}

export interface AuditType {
  type: string;
  name: string;
}

export interface AuditFilters {
  /** yyyy-MM-dd, inclusive */
  from?: string;
  /** yyyy-MM-dd, inclusive */
  to?: string;
  user?: string;
  type?: string;
  action?: AuditAction | '';
  topLevelOnly?: boolean;
}

export type AuditLogError = Error & { response?: { status?: number }; responseBody?: { error?: string } };

/** The filters as query parameters, leaving out the empty ones. */
export function filterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  const add = (key: string, value?: string) => {
    if (value && value.trim()) {
      params.set(key, value.trim());
    }
  };
  add('from', filters.from);
  add('to', filters.to);
  add('user', filters.user);
  add('type', filters.type);
  add('action', filters.action || undefined);
  if (filters.topLevelOnly) {
    params.set('topLevelOnly', 'true');
  }
  return params;
}

export function listUrl(filters: AuditFilters, startIndex: number, limit: number): string {
  const params = filterParams(filters);
  params.set('startIndex', String(startIndex));
  params.set('limit', String(limit));
  return `${baseUrl}?${params.toString()}`;
}

/**
 * The CSV download's address, for a plain link: the browser sends the session cookie and saves
 * the streamed file itself, so a large export is never held in the page.
 */
export function exportUrl(filters: AuditFilters, limit: number): string {
  const params = filterParams(filters);
  params.set('limit', String(limit));
  return withOpenmrsBase(`${baseUrl}/export?${params.toString()}`);
}

/** The framework's makeUrl, which its test mock does not provide: /ws/rest/... becomes /openmrs/ws/rest/.... */
function withOpenmrsBase(path: string): string {
  const base: string = (window as { openmrsBase?: string }).openmrsBase ?? '/openmrs';
  return base.replace(/\/$/, '') + path;
}

export function useAuditLog(filters: AuditFilters, startIndex: number, limit: number) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: AuditPage }, AuditLogError>(
    listUrl(filters, startIndex, limit),
    openmrsFetch,
    { keepPreviousData: true },
  );
  return { page: data?.data, error, isLoading, isValidating, mutate };
}

export function useAuditEntry(uuid: string | null) {
  const { data, error, isLoading } = useSWR<{ data: AuditEntryDetail }, AuditLogError>(
    uuid ? `${baseUrl}/${encodeURIComponent(uuid)}` : null,
    openmrsFetch,
  );
  return { entry: data?.data, error, isLoading };
}

export function useAuditTypes() {
  const { data, error } = useSWR<{ data: { results: Array<AuditType> } }, AuditLogError>(
    `${baseUrl}/types`,
    openmrsFetch,
  );
  return { types: data?.data?.results ?? [], error };
}

export function statusOf(error: AuditLogError | undefined): number | undefined {
  return error?.response?.status;
}

/** A recorded value as text: a list's members joined, a map as "key: value" pairs, nothing as ''. */
export function displayValue(value: AuditValue | unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => displayValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${displayValue(item)}`)
      .join(', ');
  }
  return String(value);
}
