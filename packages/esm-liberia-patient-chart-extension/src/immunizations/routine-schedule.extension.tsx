import React, { useEffect, useMemo, useState } from 'react';
import { Button, InlineNotification, InlineLoading, Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@carbon/react';
import { fhirBaseUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { clinicalDate } from './clinical-date';
import { administeredTimeline, normalizeHistory, type TimelineEntry } from './history';
import { loadHistory } from './load-history';
import { evaluateRoutineSchedule, routineSchedule, type RoutineStatus } from './routine-schedule';
import type { RoutineConfig } from './routine-config';
import styles from './routine-schedule.scss';

const statusLabels: Record<RoutineStatus, string> = {
  NOT_YET_DUE: 'Not yet due', DUE: 'Due', OVERDUE: 'Overdue',
  WAITING_FOR_PREREQUISITE: 'Waiting for prerequisite', WAITING_FOR_INTERVAL: 'Waiting for interval',
  ADMINISTERED: 'Administered', OUTSIDE_ELIGIBILITY_WINDOW: 'Outside eligibility window',
  HISTORY_UNRESOLVED: 'History unresolved',
};

/** Labels for canonical doses outside the 21-item routine schedule (which already has its own). */
const timelineOnlyLabels: Record<string, string> = {
  TD1: 'TD', TD2: 'TD2', TD3: 'TD3', TD4: 'TD4', TD5: 'TD5',
  HPV1: 'HPV1', HPV2: 'HPV2',
  PediatricPfizer1: 'Pediatric Pfizer dose 1', PediatricPfizer2: 'Pediatric Pfizer dose 2',
};

function timelineDoseLabel(canonicalDoseId: string): string {
  return routineSchedule.find((dose) => dose.id === canonicalDoseId)?.label
    ?? timelineOnlyLabels[canonicalDoseId]
    ?? canonicalDoseId;
}

const sourceLabels: Record<string, string> = {
  fhir: 'Immunization record', 'national-form': 'National Immunization form', 'anc-tt': 'ANC (Date of TT)',
};

/** record ids look like "fhir:<uuid>", "national-form:<uuid>+anc-tt:<uuid>" (coalesced), etc. */
function timelineSources(recordIds: readonly string[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const id of recordIds) {
    for (const part of id.split('+')) {
      const prefix = part.slice(0, part.indexOf(':'));
      const label = sourceLabels[prefix];
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels.join(', ');
}

export default function RoutineSchedule({ patientUuid, patient }: { patientUuid: string; patient: fhir.Patient }) {
  const { t } = useTranslation();
  const { routineImmunizations: config } = useConfig<{ routineImmunizations: RoutineConfig }>();
  const [today, setToday] = useState(() => clinicalDate(new Date().toISOString()));
  useEffect(() => {
    const timer = setInterval(() => setToday(clinicalDate(new Date().toISOString())), 30_000);
    return () => clearInterval(timer);
  }, []);
  const fhirUrl = `${fhirBaseUrl}/Immunization?patient=${encodeURIComponent(patientUuid)}`;
  // All encounters, including parallel legacy records; the adapter selects the national form.
  const obs = 'uuid,voided,concept:(uuid),value';
  const rep = `custom:(uuid,voided,patient:(uuid),form:(uuid),encounterDatetime,obs:(${obs},groupMembers:(${obs})))`;
  const encounterUrl = `${restBaseUrl}/encounter?patient=${encodeURIComponent(patientUuid)}&v=${rep}&limit=100`;
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    patientUuid ? ['liberia-routine-immunization-history', fhirUrl, encounterUrl] : null,
    () => loadHistory(new URL(fhirUrl, window.location.origin).href,
      new URL(encounterUrl, window.location.origin).href, async (url) => (await openmrsFetch(url)).data),
    { refreshInterval: 30_000 },
  );
  const normalized = useMemo(() => data && normalizeHistory({
    patientUuid,
    ...data,
    mappings: config.fhirDoseMappings,
    nationalFormUuids: config.nationalFormUuids,
    vaccineQuestionUuid: config.vaccineQuestionUuid,
    vaccineConceptUuids: config.vaccineConceptUuids,
  }), [data, patientUuid, config]);
  const rows = useMemo(() => normalized && patient?.birthDate
    ? evaluateRoutineSchedule(patient.birthDate, today, normalized, config.vaccineConceptUuids) : undefined,
    [normalized, patient?.birthDate, today, config.vaccineConceptUuids]);
  const timeline = useMemo(() => data && administeredTimeline({ patientUuid, ...data, config }),
    [data, patientUuid, config]);

  return <section className={styles.schedule} aria-label={t('routineImmunizationSchedule', 'Routine childhood immunization schedule')}>
    <h2>{t('routineImmunizationSchedule', 'Routine childhood immunization schedule')}</h2>
    <p>{t('routineScheduleAsOf', 'Based on date of birth, as of {{date}} (Liberia).', { date: today })}</p>
    <Button kind="ghost" size="sm" onClick={() => mutate()} disabled={isValidating}>
      {t('refreshImmunizationHistory', 'Refresh history')}
    </Button>
    {isLoading ? <InlineLoading description={t('loadingImmunizationHistory', 'Loading both history sources…')} />
      : error ? <InlineNotification kind="error" lowContrast hideCloseButton
        title={t('immunizationHistoryUnavailable', 'History unavailable')}
        subtitle={t('immunizationBothSourcesRequired', 'Both history sources must load before eligibility can be shown. Retry using Refresh history.')} />
      : !rows ? <InlineNotification kind="warning" lowContrast hideCloseButton
        title={t('immunizationDobRequired', 'A complete date of birth is required')} />
      : <>
        {(normalized.issues.length > 0 || rows.some((row) => row.status === 'HISTORY_UNRESOLVED')) &&
          <InlineNotification kind="warning" lowContrast hideCloseButton
            title={t('immunizationHistoryUnresolved', 'History needs reconciliation')}
            subtitle={t('immunizationHistoryUnresolvedDetail', 'Some dates or vaccine records could not be reconciled. Unresolved doses are not marked available.')} />}
        <Table size="sm" aria-label={t('routineImmunizationSchedule', 'Routine childhood immunization schedule')}>
          <TableHead><TableRow>
            <TableHeader>{t('vaccineDose', 'Vaccine dose')}</TableHeader>
            <TableHeader>{t('scheduledDate', 'Scheduled date')}</TableHeader>
            <TableHeader>{t('eligibleDate', 'Eligible date')}</TableHeader>
            <TableHeader>{t('status', 'Status')}</TableHeader>
          </TableRow></TableHead>
          <TableBody>{rows.map((row) => <TableRow key={row.dose.id}>
            <TableCell>{t(`routineDose${row.dose.id}`, row.dose.label)}</TableCell>
            <TableCell>{row.scheduledDueDate ?? '—'}</TableCell>
            <TableCell>{['WAITING_FOR_PREREQUISITE', 'HISTORY_UNRESOLVED', 'OUTSIDE_ELIGIBILITY_WINDOW', 'ADMINISTERED'].includes(row.status)
              ? '—' : row.eligibleDate}</TableCell>
            <TableCell>{t(`routineStatus${row.status}`, statusLabels[row.status])}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <h2>{t('previousImmunizations', 'Previous immunizations')}</h2>
        {!timeline?.entries.length
          ? <p>{t('noPreviousImmunizations', 'No previous immunizations recorded.')}</p>
          : <>
            {timeline.unresolved &&
              <InlineNotification kind="warning" lowContrast hideCloseButton
                title={t('immunizationHistoryUnresolved', 'History needs reconciliation')}
                subtitle={t('immunizationTimelineUnresolvedDetail', 'Some dates or vaccine records could not be reconciled. This list may be incomplete.')} />}
            <Table size="sm" aria-label={t('previousImmunizations', 'Previous immunizations')}>
              <TableHead><TableRow>
                <TableHeader>{t('vaccineDose', 'Vaccine dose')}</TableHeader>
                <TableHeader>{t('administrationDate', 'Administration date')}</TableHeader>
                <TableHeader>{t('recordedIn', 'Recorded in')}</TableHeader>
              </TableRow></TableHead>
              <TableBody>{timeline.entries.map((entry: TimelineEntry) => <TableRow key={entry.canonicalDoseId}>
                <TableCell>{t(`routineDose${entry.canonicalDoseId}`, timelineDoseLabel(entry.canonicalDoseId))}</TableCell>
                <TableCell>{entry.administeredDate}</TableCell>
                <TableCell>{timelineSources(entry.recordIds)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </>}
      </>}
  </section>;
}
