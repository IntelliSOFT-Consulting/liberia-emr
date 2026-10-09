import React from 'react';
import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { formatDate, useLayoutType, usePagination } from '@openmrs/esm-framework';
import { CardHeader, PatientChartPagination } from '@openmrs/esm-patient-common-lib';
import { useTranslation } from 'react-i18next';
import type { ExternalRow, SectionDefinition } from '../external-records-sections';
import ExternalTags from './external-tags.component';
import styles from '../external-records.scss';

interface ExternalRecordsTableProps<T extends ExternalRow> {
  section: SectionDefinition<T>;
  rows: Array<T>;
  pageSize: number;
}

const formatIso = (iso: string) => formatDate(new Date(iso), { time: false, noToday: true });

/** Any External records section: tags, read-only rows with their facility, paging. No actions by design. */
function ExternalRecordsTable<T extends ExternalRow>({ section, rows, pageSize }: ExternalRecordsTableProps<T>) {
  const { t } = useTranslation();
  const isTablet = useLayoutType() === 'tablet';
  const { results, goTo, currentPage } = usePagination(rows, pageSize);
  const title = section.title(t);

  const headers = [
    ...section.columns.map((column) => ({ key: column.key, header: column.header(t) })),
    { key: 'facility', header: t('facility', 'Facility') },
  ];
  const tableRows = results.map((row) => ({
    id: row.id,
    ...Object.fromEntries(section.columns.map((column) => [column.key, column.value(row, formatIso)])),
    facility: row.facility.name ?? t('unknownFacility', 'Unknown facility'),
  }));

  return (
    <div className={styles.widget}>
      <CardHeader title={title}>
        <ExternalTags />
      </CardHeader>
      {rows.length === 0 ? (
        <p className={styles.noRows}>
          {t('noSectionRows', 'No {{section}} from other facilities', { section: title.toLowerCase() })}
        </p>
      ) : (
        <>
          <DataTable rows={tableRows} headers={headers} size={isTablet ? 'lg' : 'sm'} useZebraStyles>
            {({ rows: dataRows, headers: dataHeaders, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()} aria-label={title}>
                  <TableHead>
                    <TableRow>
                      {dataHeaders.map((header) => (
                        <TableHeader {...getHeaderProps({ header })} key={header.key}>
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dataRows.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id} className={cell.info.header === 'facility' ? styles.facility : ''}>
                            {cell.value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
          <PatientChartPagination
            pageNumber={currentPage}
            totalItems={rows.length}
            currentItems={results.length}
            pageSize={pageSize}
            onPageNumberChange={({ page }) => goTo(page)}
          />
        </>
      )}
    </div>
  );
}

export default ExternalRecordsTable;
