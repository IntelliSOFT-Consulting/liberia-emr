import { useMemo } from 'react';
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
  encounterType?: { uuid: string; display: string };
  form?: { uuid: string; name: string; display?: string };
  obs: ObsRep[];
}

export interface UsePartographEncountersResult {
  /** All partograph serial encounters, sorted oldest-first (earliest record = index 0). */
  encounters: PartographEncounter[];
  /** Encounter representing delivery (from Stage 3 or Delivery encounter type), if recorded. */
  deliveryEncounter?: PartographEncounter;
  /** Whether delivery has been documented for this patient/labour course. */
  isDelivered: boolean;
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
export function usePartographEncounters(patientUuid: string): UsePartographEncountersResult {
  const config = useConfig<EPartographConfig>();

  const queryString = [
    `patient=${patientUuid}`,
    'v=custom:(uuid,encounterDatetime,encounterType:(uuid,display),form:(uuid,name,display),obs:(uuid,concept:(uuid,display),value,display))',
    'limit=100',
  ].join('&');

  const url = `${restBaseUrl}/encounter?${queryString}`;

  const { data, error, isLoading, mutate } = useSWR<{ data: { results: PartographEncounter[] } }, Error>(
    patientUuid ? url : null,
    (fetchUrl: string) => openmrsFetch(`${fetchUrl}&_=${Date.now()}`),
  );

  const rawEncounters = data?.data?.results ?? [];

  // 1. Identify all Partograph serial encounters (sorted chronologically)
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
      if (/first and second stage|labour admission/i.test(formName)) {
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
      .filter((enc) => {
        // Check Delivery encounter type via configuration
        if (
          config.deliveryEncounterTypeUuid &&
          enc.encounterType?.uuid === config.deliveryEncounterTypeUuid
        ) {
          return true;
        }

        // Check configured Third Stage form UUID
        if (config.thirdStageFormUuid && enc.form?.uuid === config.thirdStageFormUuid) {
          return true;
        }

        // Check form name for Stage 3 or Delivery Summary (anchored to avoid matching Stage 1 / Stage 2)
        const formName = enc.form?.name || enc.form?.display || '';
        if (/^3\.|third stage|delivery summary/i.test(formName)) return true;

        return false;
      })
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

  return { encounters: currentLabourEncounters, deliveryEncounter, isDelivered, isLoading, error, mutate };
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
