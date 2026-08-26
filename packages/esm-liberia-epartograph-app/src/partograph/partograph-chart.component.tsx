/**
 * partograph-chart.component.tsx
 *
 * Entry point for the `partograph-chart` extension registered in routes.json.
 * This component is mounted inside `patient-chart-partograph-dashboard-slot`
 * (i.e. the full-page dashboard view on the right when the user clicks
 * "Partograph" in the left-hand navigation).
 *
 * It simply mounts the PartographMain container which provides the full
 * Table/Graph switchable UI with WHO clinical decision support.
 */
import React from 'react';
import PartographMain from './partograph-main.component';

interface PartographChartProps {
  patientUuid: string;
}

const PartographChart: React.FC<PartographChartProps> = ({ patientUuid }) => {
  return <PartographMain patientUuid={patientUuid} />;
};

export default PartographChart;
