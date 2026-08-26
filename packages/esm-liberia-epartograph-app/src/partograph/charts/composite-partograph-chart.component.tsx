import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart, type LineChartOptions, ScaleTypes } from '@carbon/charts-react';
import { formatDatetime } from '@openmrs/esm-framework';
import { findObs, getNumericObsValue, type PartographEncounter } from '../use-partograph-encounters';
import { generateAlertLinePoints, generateActionLinePoints } from '../cds/use-partograph-alerts';
import type { EPartographConfig } from '../../config-schema';
import styles from '../partograph-main.scss';

interface CompositePartographChartProps {
  encounters: PartographEncounter[];
  config: EPartographConfig;
  /** If provided, renders the single-series Fetal Heart Rate chart instead of composite. */
  seriesConceptUuid?: string;
  seriesLabel?: string;
  title: string;
}

/**
 * CompositePartographChart
 *
 * Renders either:
 *  A) The dual-axis composite WHO partograph chart (Cervical Dilation + Fetal Head Descent)
 *     with the WHO Alert Line and Action Line drawn as reference series.
 *  B) A single-series trend chart for concepts like FHR, Pulse, BP, Temp.
 *
 * Uses `@carbon/charts-react` LineChart. The Alert/Action lines are
 * injected as additional data series using pre-computed point arrays.
 */
const CompositePartographChart: React.FC<CompositePartographChartProps> = ({
  encounters,
  config,
  seriesConceptUuid,
  seriesLabel,
  title,
}) => {
  const { t } = useTranslation();
  const { startDilationCm, cmPerHour, actionLineOffsetHours } = config.alertLine;

  // --- Find T₀ for WHO line computation ---
  const t0 = useMemo(() => {
    if (!config.concepts.cervicalDilationUuid) return null;
    for (const enc of encounters) {
      const obs = findObs(enc, config.concepts.cervicalDilationUuid);
      const dilation = getNumericObsValue(obs);
      if (dilation !== null && dilation >= startDilationCm) {
        return new Date(enc.encounterDatetime);
      }
    }
    return null;
  }, [encounters, config.concepts.cervicalDilationUuid, startDilationCm]);

  // --- Build chart data ---
  const chartData = useMemo(() => {
    if (seriesConceptUuid) {
      // Single-series mode (FHR, Pulse, BP, Temp, etc.)
      return encounters
        .map((enc) => {
          const obs = findObs(enc, seriesConceptUuid);
          const value = getNumericObsValue(obs);
          if (value === null) return null;
          return { group: seriesLabel ?? seriesConceptUuid, key: new Date(enc.encounterDatetime), value, date: enc.encounterDatetime };
        })
        .filter(Boolean);
    }

    // Composite mode: Cervical Dilation + Fetal Head Descent + WHO lines
    const dilationPoints = encounters
      .map((enc) => {
        const obs = findObs(enc, config.concepts.cervicalDilationUuid);
        const value = getNumericObsValue(obs);
        if (value === null) return null;
        return { group: t('cervicalDilation', 'Cervical Dilatation'), key: new Date(enc.encounterDatetime), value, date: enc.encounterDatetime };
      })
      .filter(Boolean);

    const descentPoints = encounters
      .map((enc) => {
        const obs = findObs(enc, config.concepts.descentOfHeadUuid);
        const value = getNumericObsValue(obs);
        if (value === null) return null;
        return { group: t('fetalHeadDescent', 'Fetal Head Descent'), key: new Date(enc.encounterDatetime), value, date: enc.encounterDatetime };
      })
      .filter(Boolean);

    // WHO Alert and Action Lines — only rendered if T₀ is known
    const alertPoints = t0
      ? generateAlertLinePoints(t0, startDilationCm, cmPerHour).map((p) => ({
          group: t('alertLine', 'ALERT'),
          key: p.x,
          value: p.y,
          date: p.x.toISOString(),
        }))
      : [];

    const actionPoints = t0
      ? generateActionLinePoints(t0, startDilationCm, cmPerHour, actionLineOffsetHours).map((p) => ({
          group: t('actionLine', 'ACTION'),
          key: p.x,
          value: p.y,
          date: p.x.toISOString(),
        }))
      : [];

    return [...dilationPoints, ...descentPoints, ...alertPoints, ...actionPoints];
  }, [encounters, config, seriesConceptUuid, seriesLabel, t, t0, startDilationCm, cmPerHour, actionLineOffsetHours]);

  const chartOptions: LineChartOptions = useMemo(
    () => ({
      title,
      axes: {
        bottom: {
          title: t('time', 'Time'),
          mapsTo: 'key',
          scaleType: ScaleTypes.TIME,
        },
        left: {
          mapsTo: 'value',
          scaleType: ScaleTypes.LINEAR,
          includeZero: true,
          ...(seriesConceptUuid
            ? {}
            : {
                title: t('dilation', 'Dilation / Descent'),
                domain: [0, 10],
              }),
        },
      },
      color: {
        scale: {
          // WHO-standard colours for the partograph
          [t('cervicalDilation', 'Cervical Dilatation')]: '#8a3ffc',    // purple
          [t('fetalHeadDescent', 'Fetal Head Descent')]: '#24a148',      // green
          [t('alertLine', 'ALERT')]: '#161616',                          // near-black
          [t('actionLine', 'ACTION')]: '#161616',                        // near-black
        },
      },
      curve: 'curveLinear',
      points: {
        enabled: true,
        radius: ((d: any) => {
          const group = d?.group || d?.dataGroupName || '';
          if (/alert|action/i.test(group)) {
            return 0;
          }
          return 4;
        }) as any,
      },
      legend: { enabled: !seriesConceptUuid }, // hide legend for single-series
      tooltip: {
        customHTML: ([{ value, group, date }]: any) => {
          const dateLabel = t('date', 'Date');
          return `<div class="cds--tooltip cds--tooltip--shown" style="min-width:max-content;font-weight:600">
              <div style="font-size:1rem;line-height:1.4">${group}: <span>${value}</span></div>
              <div style="color:#6F6F6F;font-size:0.875rem;font-weight:500;margin-top:0.125rem">${dateLabel}: ${formatDatetime(new Date(date), { mode: 'wide' })}</div>
            </div>`;
        },
      },
      toolbar: {
        enabled: true,
        numberOfIcons: 4,
        controls: [
          { type: 'Zoom in' },
          { type: 'Zoom out' },
          { type: 'Reset zoom' },
          { type: 'Export as PNG' },
          { type: 'Make fullscreen' },
        ],
      },
      zoomBar: { top: { enabled: true } },
      height: '400px',
    }),
    [t, title, seriesConceptUuid],
  );

  if (!chartData.length) {
    return (
      <div className={styles.graphPlaceholder}>
        <p>{t('noDataAvailable', 'No data available for this graph.')}</p>
      </div>
    );
  }

  return (
    <div className={styles.lineChartContainer}>
      <LineChart data={chartData as any} options={chartOptions} />
    </div>
  );
};

export default CompositePartographChart;
