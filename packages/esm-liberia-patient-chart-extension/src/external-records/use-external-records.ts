import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import {
  duration,
  formatDatetime,
  getLocale,
  openmrsFetch,
  restBaseUrl,
  showSnackbar,
  useSession,
  userHasAccess,
} from '@openmrs/esm-framework';
import {
  countRows,
  refreshSnackbar,
  toFacilities,
  toSections,
  toStatus,
  type ExternalRecordsStatus,
  type ExternalSections,
  type FacilitySummary,
  type LocalHistoryResponse,
  type RefreshResponse,
} from './external-records';
import { formatAsOf, type DateHelpers } from './format-as-of';

export const viewRemoteHistoryPrivilege = 'View Remote History';

const emptySections = toSections([]);

/** O3's own date helpers, so "as of" reads like every other date in the chart. */
export const dateHelpers = (): DateHelpers => ({
  formatDatetime: (date) => formatDatetime(date, { noToday: true }),
  duration: (from, to) => duration(from, to),
  locale: getLocale(),
});

export interface ExternalRecords {
  /** False for a patient never imported, or a user without View Remote History: render nothing. */
  isImported: boolean;
  status: ExternalRecordsStatus | null;
  /** When the copy shown was fetched from central (ISO), or null if never. */
  asOf: string | null;
  facilities: Array<FacilitySummary>;
  sections: ExternalSections;
  isLoading: boolean;
  isRefreshing: boolean;
  /** Fetches from central now, re-reads the local copy and shows the outcome snackbar. */
  refresh: () => Promise<void>;
}

/** Reads only this facility's copy of an imported patient's history from other facilities. */
export function useExternalRecords(patientUuid: string): ExternalRecords {
  const { t } = useTranslation();
  const session = useSession();
  const allowed = Boolean(session?.user && userHasAccess(viewRemoteHistoryPrivilege, session.user));
  const url = `${restBaseUrl}/liberiaemr/remotehistory/local/${patientUuid}`;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<LocalHistoryResponse>(
    allowed && patientUuid ? url : null,
    (key: string) => openmrsFetch<LocalHistoryResponse>(key).then((response) => response.data),
    { revalidateOnFocus: false },
  );

  const sections = useMemo(() => (data?.imported ? toSections(data.sources) : emptySections), [data]);
  const facilities = useMemo(() => toFacilities(sections), [sections]);
  const status = toStatus(data, countRows(sections), Boolean(error));

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const previous = data?.fetchedAt ?? null;
    let result: RefreshResponse | null = null;
    try {
      result = (
        await openmrsFetch<RefreshResponse>(`${url}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {},
        })
      ).data;
    } catch {
      // Unreachable: the snackbar says so and the cached copy stays.
    }
    try {
      await mutate();
    } catch {
      // Offline: SWR keeps the last copy.
    } finally {
      setIsRefreshing(false);
    }
    showSnackbar({
      isLowContrast: true,
      ...refreshSnackbar(result, previous, (when) => formatAsOf(when, new Date(), dateHelpers(), t), t),
    });
  }, [data?.fetchedAt, mutate, t, url]);

  return {
    isImported: allowed && Boolean(data?.imported),
    status: allowed ? status : null,
    asOf: data?.fetchedAt ?? null,
    facilities,
    sections,
    isLoading: allowed && isLoading,
    isRefreshing,
    refresh,
  };
}
