import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@carbon/react';
import { describePart, formatValue, groupByIndicator } from './disaggregation';
import type { EvaluatedDataSet } from './reports.resource';
import styles from './reports.scss';

interface ReportResultsProps {
  dataSet: EvaluatedDataSet;
}

/**
 * One block of rows per indicator code, one row per disaggregation. The indicators data set has
 * one row (docs/reporting/README.md 3.3); a per-facility breakdown is a separate data set and is
 * not shown here.
 */
const ReportResults: React.FC<ReportResultsProps> = ({ dataSet }) => {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupByIndicator(dataSet?.metadata?.columns ?? [], dataSet?.rows?.[0] ?? {}),
    [dataSet],
  );

  if (!groups.length) {
    return <p className={styles.helper}>{t('noResults', 'The report returned no figures.')}</p>;
  }

  return (
    <TableContainer title={t('results', 'Results')} className={styles.results}>
      <Table size="sm" aria-label={t('results', 'Results')}>
        <TableHead>
          <TableRow>
            <TableHeader>{t('indicator', 'Indicator')}</TableHeader>
            <TableHeader>{t('disaggregation', 'Disaggregation')}</TableHeader>
            <TableHeader>{t('dataElement', 'Data element')}</TableHeader>
            <TableHeader className={styles.value}>{t('value', 'Value')}</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.flatMap((group) =>
            group.cells.map((cell, index) => (
              <TableRow key={cell.column} data-testid={`cell-${cell.column}`}>
                <TableCell className={index === 0 ? styles.indicatorCode : styles.indicatorRepeat}>
                  {index === 0 ? group.code || t('otherColumns', 'Other') : ''}
                </TableCell>
                <TableCell>{group.code ? describePart(cell.part, t) : cell.column}</TableCell>
                <TableCell>{cell.label}</TableCell>
                <TableCell className={styles.value}>{formatValue(cell.value)}</TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ReportResults;
