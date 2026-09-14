/**
 * partograph-dashboard-link.component.tsx
 *
 * Renders the "Partograph" entry in the patient chart left-hand navigation.
 * Uses `createDashboardLink` from @openmrs/esm-patient-common-lib (the same
 * pattern used by Vitals, Allergies, Programs, etc.).
 *
 * This component is registered in routes.json against `patient-chart-dashboard-slot`.
 * The meta.slot and meta.path values there define what slot it reveals and what
 * URL segment it navigates to.
 */
import React, { useMemo } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardExtension } from '@openmrs/esm-styleguide';
import { getGlobalStore, usePatient } from '@openmrs/esm-framework';
import type { PatientChartStore } from '@openmrs/esm-patient-common-lib';

interface PartographDashboardLinkProps {
  basePath: string;
}

const PartographDashboardLink: React.FC<PartographDashboardLinkProps> = ({ basePath }) => {
  const patientUuid = useMemo(() => {
    const match = basePath?.match(/patient\/([0-9a-fA-F-]+)/);
    return match ? match[1] : '';
  }, [basePath]);

  const { patient } = usePatient(patientUuid);
  const chartStorePatient = getGlobalStore<PatientChartStore>('patient-chart-global-store')?.getState()?.patient;

  const currentPatient = patient ?? chartStorePatient;
  const gender = currentPatient?.gender?.toLowerCase();

  // Hide the Partograph dashboard link if the patient is not female
  if (currentPatient && gender !== 'female' && gender !== 'f') {
    return null;
  }

  return (
    <BrowserRouter>
      <DashboardExtension basePath={basePath} title="Partograph" path="partograph" icon="omrs-icon-mother" />
    </BrowserRouter>
  );
};

export default PartographDashboardLink;
