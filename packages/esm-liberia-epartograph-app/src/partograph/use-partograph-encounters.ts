import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { getGlobalStore, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { usePatientChartStore, type PatientChartStore } from '@openmrs/esm-patient-common-lib';
import type { EPartographConfig } from '../config-schema';
import { isDeliveryEncounter } from '../forms/labour-episode';

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
  encounterType?: { uuid: string; display: string };
  form?: { uuid: string; name: string; display?: string };
  obs: ObsRep[];
}

export interface UsePartographEncountersResult {
  /** All active labour partograph serial encounters (from T₀ onwards), sorted oldest-first. */
  encounters: PartographEncounter[];
  /** Encounter representing delivery (from Stage 3 or Delivery encounter type), if recorded. */
  deliveryEncounter?: PartographEncounter;
  /** Whether delivery has been documented for this patient/labour course. */
  isDelivered: boolean;
  /** Whether a "1. First and Second Stage of Labor and Delivery" admission encounter exists. */
  hasAdmissionEncounter: boolean;
  /** Whether cervical dilatation has reached the active labour threshold (>= 4 cm). */
  hasActiveLabourDilation: boolean;
  /** The timestamp of the first encounter where cervical dilatation reached >= 4 cm (T₀). */
  t0?: Date;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<any>;
}

/**
 * usePartographEncounters
 *
 * Obstetrical Clinical Architecture:
 * ─────────────────────────────────────────────────────────────────────────────
 * Labour & Delivery in Liberia EMR spans 4 distinct stages:
 *
 *  1. Stage 1 (Admission & Latent phase):
 *     - Form: "1. First and Second Stage of Labor and Delivery"
 *     - Records admission, baseline history, and initial vaginal examination.
 *     - If cervical dilation is >= 4 cm upon admission, that entry marks the
 *       beginning of active labour (T₀) and is included in the Partograph series.
 *
 *  2. Active Intrapartum Monitoring (The Partograph):
 *     - Form: "2. Partograph" (Encounter Type: Labor & Delivery / Partograph Observation)
 *     - Serial observations (every 30m–4h) of cervical dilatation, fetal head
 *       descent, contractions, fetal heart rate, moulding, and amniotic fluid.
 *     - Plotted against the WHO Alert & Action lines.
 *
 *  3. Stage 3 (Delivery of Infant and Placenta):
 *     - Form: "3. Third Stage of Labor and Delivery" / Delivery Summary
 *     - Records delivery time, APGAR scores, AMTSL, placenta delivery, blood loss.
 *     - Clinically marks the CONCLUSION of the Partograph. When a Stage 3 or
 *       Delivery encounter exists, the Partograph CDS engine recognizes that labour
 *       has finished and automatically suppresses intrapartum alerts ("Update Due").
 *
 *  4. Stage 4 (Immediate Postpartum Recovery):
 *     - Form: "4. Fourth Stage Monitoring for Woman and Baby"
 *     - Postpartum maternal vitals, uterine tone, lochia, newborn feeding.
 *     - Excluded from the Partograph table because active labour has concluded.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function usePartographEncounters(patientUuid: string | null): UsePartographEncountersResult {
  const config = useConfig<EPartographConfig>();
  const { visitContext } = usePatientChartStore(patientUuid ?? '');

  const queryString = [
    `patient=${patientUuid}`,
    'v=custom:(uuid,encounterDatetime,encounterType:(uuid,display),form:(uuid,name,display),obs:(uuid,concept:(uuid,display),value,display))',
    'limit=100',
  ].join('&');

  const url = `${restBaseUrl}/encounter?${queryString}`;

  const { data, error, isLoading, mutate } = useSWR<{ data: { results: PartographEncounter[] } }, Error>(
    patientUuid ? url : null,
    (fetchUrl: string) => openmrsFetch(`${fetchUrl}&_=${Date.now()}`),
    {
      revalidateOnFocus: true,
      refreshInterval: 3000,
    },
  );

  // 1. Automatically revalidate when patient chart visit context changes
  useEffect(() => {
    if (patientUuid) {
      mutate();
    }
  }, [visitContext, patientUuid, mutate]);

  // 2. Subscribe to patient-chart-global-store updates (e.g. form saves that update visits/encounters)
  useEffect(() => {
    const store = getGlobalStore<PatientChartStore>('patient-chart-global-store');
    if (!store) return;
    let timer: NodeJS.Timeout | undefined;
    const unsubscribe = store.subscribe(() => {
      mutate();
      timer = setTimeout(() => mutate(), 1000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [mutate]);

  // 3. Subscribe to workspace2 store to revalidate when workspace drawer closes (e.g. form entry closed with saved changes)
  useEffect(() => {
    const wsStore = getGlobalStore<{ openedWindows: any[] }>('workspace2');
    if (!wsStore) return;
    let prevCount = wsStore.getState()?.openedWindows?.length ?? 0;
    let timer: NodeJS.Timeout | undefined;
    const unsubscribe = wsStore.subscribe((state) => {
      const currentCount = state?.openedWindows?.length ?? 0;
      if (prevCount > 0 && currentCount === 0) {
        mutate();
        timer = setTimeout(() => mutate(), 1000);
      }
      prevCount = currentCount;
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [mutate]);

  const rawEncounters = data?.data?.results ?? [];

  const admissionFormUuid = config.firstAndSecondStageFormUuid;

  // 1. Identify if a Stage 1 admission encounter exists
  const hasAdmissionEncounter = useMemo(() => {
    return rawEncounters.some((enc) => {
      const formName = enc.form?.name || enc.form?.display || '';
      const encTypeName = enc.encounterType?.display || '';
      if (/first and second stage|labour admission/i.test(formName)) return true;
      if (/first and second stage|labour admission/i.test(encTypeName)) return true;
      if (enc.form?.uuid === admissionFormUuid) return true;
      return false;
    });
  }, [rawEncounters, admissionFormUuid]);

  // 2. Identify all Partograph serial encounters (sorted chronologically)
  const allPartographEncounters = useMemo(() => {
    const filtered = rawEncounters.filter((enc) => {
      const formName = enc.form?.name || enc.form?.display || '';

      // A. Explicit Partograph forms ("2. Partograph", "Partograph", or configured formUuid)
      if (/partograph/i.test(formName)) return true;
      if (config.formUuid && enc.form?.uuid === config.formUuid) return true;

      // B. Dedicated "Partograph Observation" encounter type
      if (config.encounterTypeUuid && enc.encounterType?.uuid === config.encounterTypeUuid) {
        return true;
      }

      // C. Check if Stage 1 Admission recorded active-phase cervical dilation (>= 4 cm)
      if (/first and second stage|labour admission/i.test(formName) || enc.form?.uuid === admissionFormUuid) {
        const dilationObs = config.concepts?.cervicalDilationUuid
          ? enc.obs?.find((o) => o.concept?.uuid === config.concepts.cervicalDilationUuid)
          : undefined;
        const dilationVal = dilationObs ? parseFloat(String(dilationObs.value)) : null;
        if (dilationVal !== null && dilationVal >= (config.alertLine?.startDilationCm ?? 4)) {
          return true; // Include admission dilation as T₀ anchor
        }
      }

      // D. Encounter containing core intrapartum partograph tracking concepts
      const coreConcepts = [
        config.concepts?.cervicalDilationUuid,
        config.concepts?.descentOfHeadUuid,
        config.concepts?.contractionsPerTenMinutesUuid,
        config.concepts?.contractionDurationUuid,
        config.concepts?.mouldingUuid,
        config.concepts?.amnioticFluidUuid,
      ].filter(Boolean);

      return enc.obs?.some((o) => coreConcepts.includes(o.concept?.uuid));
    });

    return filtered.sort(
      (a, b) => new Date(a.encounterDatetime).getTime() - new Date(b.encounterDatetime).getTime(),
    );
  }, [rawEncounters, config]);

  // 2. Identify all Delivery encounters (Stage 3 / Delivery Summary) sorted chronologically
  const deliveryEncounters = useMemo(() => {
    return rawEncounters
      .filter((enc) => isDeliveryEncounter(enc, config))
      .sort((a, b) => new Date(a.encounterDatetime).getTime() - new Date(b.encounterDatetime).getTime());
  }, [rawEncounters, config]);

  // 3. Subsequent Pregnancy & Episode-of-Care Resolution:
  //
  // A patient can have multiple pregnancies over time.
  // When a woman returns pregnant years later, a historical Stage 3 encounter in her
  // record must NEVER suppress alerts for her new labour.
  //
  // - If any Partograph encounter is recorded AFTER the latest delivery, this indicates
  //   a NEW labour episode! isDelivered becomes false, and alerts reactivate immediately.
  // - Only encounters belonging to the current labour episode (after the previous delivery)
  //   are plotted on the active partograph chart.
  const { currentLabourEncounters, deliveryEncounter, isDelivered } = useMemo(() => {
    if (!deliveryEncounters.length) {
      return {
        currentLabourEncounters: allPartographEncounters,
        deliveryEncounter: undefined,
        isDelivered: false,
      };
    }

    const latestDeliveryEnc = deliveryEncounters[deliveryEncounters.length - 1];
    const latestDeliveryTime = new Date(latestDeliveryEnc.encounterDatetime).getTime();

    // Check if new Partograph observations exist AFTER that delivery
    const encountersAfterDelivery = allPartographEncounters.filter(
      (enc) => new Date(enc.encounterDatetime).getTime() > latestDeliveryTime,
    );

    if (encountersAfterDelivery.length > 0) {
      // Subsequent pregnancy: a new labour has commenced after the previous delivery!
      // This new labour has NOT delivered yet. Alerts are fully ACTIVE.
      return {
        currentLabourEncounters: encountersAfterDelivery,
        deliveryEncounter: undefined,
        isDelivered: false,
      };
    }

    // Otherwise, the latest delivery occurred after or at the latest partograph observations.
    // The current labour course has concluded with delivery.
    // Bound the current episode to encounters after the previous delivery (if one exists)
    // to cleanly isolate the current pregnancy from historical ones while preserving the T₀ anchor.
    const previousDeliveryTime =
      deliveryEncounters.length > 1
        ? new Date(deliveryEncounters[deliveryEncounters.length - 2].encounterDatetime).getTime()
        : 0;

    const concludedLabourEncounters = allPartographEncounters.filter((enc) => {
      const encTime = new Date(enc.encounterDatetime).getTime();
      return encTime > previousDeliveryTime && encTime <= latestDeliveryTime;
    });

    return {
      currentLabourEncounters: concludedLabourEncounters,
      deliveryEncounter: latestDeliveryEnc,
      isDelivered: true,
    };
  }, [allPartographEncounters, deliveryEncounters]);

  // 4. Active Labour Threshold & T₀ Resolution (WHO Guidelines):
  //
  // Active intrapartum monitoring and partograph plotting only begin when
  // cervical dilatation reaches ≥ 4 cm (the active phase of labour).
  // Latent phase assessments (< 4 cm) are not plotted on the active partograph.
  //
  // - Scan candidate encounters in chronological order for the first encounter
  //   where cervical dilatation is ≥ 4 cm. This encounter timestamp establishes T₀.
  // - If found, filter encounters to only include those at or after T₀.
  // - If not found, labour has not yet reached 4 cm. hasActiveLabourDilation is false,
  //   and encounters are empty so the dashboard displays the appropriate clinical notice.
  const { activeEncounters, t0, hasActiveLabourDilation } = useMemo(() => {
    const startDilationCm = config.alertLine?.startDilationCm ?? 4;
    let t0Date: Date | undefined;

    for (const enc of currentLabourEncounters) {
      const obs = findObs(enc, config.concepts?.cervicalDilationUuid);
      const dilation = getNumericObsValue(obs, config);
      if (dilation !== null && dilation >= startDilationCm) {
        t0Date = new Date(enc.encounterDatetime);
        break;
      }
    }

    if (!t0Date) {
      return {
        activeEncounters: [] as PartographEncounter[],
        t0: undefined,
        hasActiveLabourDilation: false,
      };
    }

    const t0Time = t0Date.getTime();
    const filtered = currentLabourEncounters.filter(
      (enc) => new Date(enc.encounterDatetime).getTime() >= t0Time,
    );

    return {
      activeEncounters: filtered,
      t0: t0Date,
      hasActiveLabourDilation: true,
    };
  }, [currentLabourEncounters, config]);

  return {
    encounters: activeEncounters,
    deliveryEncounter,
    isDelivered,
    hasAdmissionEncounter,
    hasActiveLabourDilation,
    t0,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Extracts a numeric value from an obs REST response.
 * Returns `null` if the value cannot be parsed as a finite number or ordinal scale.
 * Supports configurable concept UUIDs via config, plus generic clinical parsing
 * for semi-quantitative scales (Negative -> 0, + -> 1, ++ -> 2, +++ -> 3, ++++ -> 4).
 */
export function getNumericObsValue(
  obs: ObsRep | undefined,
  config?: EPartographConfig,
): number | null {
  if (!obs) return null;

  // 1. If obs.value is already a numeric type
  if (typeof obs.value === 'number' && Number.isFinite(obs.value)) {
    return obs.value;
  }

  // 2. Configured concept UUID matching from runtime configuration (no hardcoded UUIDs)
  const valueUuid =
    typeof obs.value === 'object' && obs.value !== null
      ? (obs.value as { uuid?: string }).uuid
      : undefined;

  if (valueUuid && config?.concepts) {
    if (config.concepts.negativeDipstickUuid && valueUuid === config.concepts.negativeDipstickUuid) return 0;
    if (config.concepts.plus1DipstickUuid && valueUuid === config.concepts.plus1DipstickUuid) return 1;
    if (config.concepts.plus2DipstickUuid && valueUuid === config.concepts.plus2DipstickUuid) return 2;
    if (config.concepts.plus3DipstickUuid && valueUuid === config.concepts.plus3DipstickUuid) return 3;
    if (config.concepts.plus4DipstickUuid && valueUuid === config.concepts.plus4DipstickUuid) return 4;
  }

  // 3. Generic clinical text matching for ordinal scales
  // Works dynamically across any OpenMRS concept dictionary (CIEL, SNOMED, local, etc.)
  const raw =
    typeof obs.value === 'object' && obs.value !== null
      ? (obs.value as { display?: string }).display
      : obs.value;
  const str = String(raw ?? '').trim().toLowerCase();

  if (!str) return null;

  // Negative / Nil / Normal / 0 / None
  if (/negative|neg\b|^0$|^-$/i.test(str)) return 0;

  // Check 4+, 3+, 2+, 1+ (accounting for "(Dipstick)", "+ — ...", words like "four plus")
  if (str.includes('4+') || str.includes('++++') || /four\s*plus/i.test(str)) return 4;
  if (str.includes('3+') || str.includes('+++') || /three\s*plus/i.test(str)) return 3;
  if (str.includes('2+') || str.includes('++') || /two\s*plus/i.test(str)) return 2;
  if (
    str.includes('1+') ||
    str === '+' ||
    /one\s*plus/i.test(str) ||
    /^\+\s/.test(str) ||
    str.startsWith('+ (') ||
    str.startsWith('+ -') ||
    str.startsWith('+ —')
  ) {
    return 1;
  }

  // 4. Standard float parsing for continuous numbers (FHR, BP, Temp, dilation, etc.)
  const num = parseFloat(str);
  if (Number.isFinite(num)) return num;

  return null;
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
