import React, { useEffect, useMemo, useState } from 'react';
import { Button, InlineNotification, InlineLoading, Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@carbon/react';
import { fhirBaseUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { clinicalDate } from './clinical-date';
import { normalizeHistory } from './history';
import { loadHistory } from './load-history';
import { evaluateRoutineSchedule, type RoutineStatus } from './routine-schedule';
import type { RoutineConfig } from './routine-config';
import styles from './routine-schedule.scss';

const statusLabels: Record<RoutineStatus, string> = {
  NOT_YET_DUE: 'Not yet due', DUE: 'Due', OVERDUE: 'Overdue',
  WAITING_FOR_PREREQUISITE: 'Waiting for prerequisite', WAITING_FOR_INTERVAL: 'Waiting for interval',
  ADMINISTERED: 'Administered', OUTSIDE_ELIGIBILITY_WINDOW: 'Outside eligibility window',
  HISTORY_UNRESOLVED: 'History unresolved',
};

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
  const normalized = useMemo(() => data && normalizeHistory({ patientUuid, ...data, mappings: config.fhirDoseMappings }),
    [data, patientUuid, config.fhirDoseMappings]);
  const rows = useMemo(() => normalized && patient?.birthDate
    ? evaluateRoutineSchedule(patient.birthDate, today, normalized) : undefined, [normalized, patient?.birthDate, today]);

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
      </>}
  </section>;
}
