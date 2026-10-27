import { useEffect, useRef } from 'react';
import { useSWRConfig } from 'swr';
import { restBaseUrl } from '@openmrs/esm-framework';
import { encounterSignature, isPatientFlagsKey } from './patient-flags-key';

/** patientflags regenerates stored flags on a background thread after the save commits. */
const REGENERATION_SETTLE_MS = 2000;

/**
 * The flags banner is not revalidated by form saves, so a flag a new encounter resolves (LE-614)
 * stays until reload. Refetches the patient's flags whenever the encounter list gains or loses one.
 */
export function useRefreshPatientFlags(patientUuid: string, encounters: ReadonlyArray<{ uuid: string }>, isLoading: boolean) {
  // Bound to the framework's shared cache; the global `mutate` targets SWR's default cache, which no app reads.
  const { mutate } = useSWRConfig();
  const signature = encounterSignature(encounters);
  const previous = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!patientUuid || isLoading) {
      return;
    }
    const changed = previous.current !== undefined && previous.current !== signature;
    previous.current = signature;
    if (!changed) {
      return;
    }
    const refresh = () => mutate((key) => isPatientFlagsKey(key, restBaseUrl, patientUuid));
    refresh();
    const timer = setTimeout(refresh, REGENERATION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [patientUuid, signature, isLoading, mutate]);
}
