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
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardExtension } from '@openmrs/esm-styleguide';

interface PartographDashboardLinkProps {
  basePath: string;
}

const PartographDashboardLink: React.FC<PartographDashboardLinkProps> = ({ basePath }) => {
  return (
    <BrowserRouter>
      <DashboardExtension basePath={basePath} title="Partograph" path="partograph" />
    </BrowserRouter>
  );
};

export default PartographDashboardLink;
