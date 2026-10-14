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
import ExternalEmptyRows from './external-empty-rows.component';
import ExternalTags from './external-tags.component';
import styles from '../external-records.scss';

interface ExternalRecordsTableProps<T extends ExternalRow> {
  section: SectionDefinition<T>;
  rows: Array<T>;
  pageSize: number;
  /** Card (4a) or dashboard (5a) columns and title. */
  variant?: 'summary' | 'dashboard';
  /** Who the rows are from, for "No … recorded at …"; defaults to other facilities. */
  facilityLabel?: string;
}

const formatIso = (iso: string) => formatDate(new Date(iso), { time: false, noToday: true });

/** Any External records section: tags, read-only rows with their facility, paging. No actions by design. */
function ExternalRecordsTable<T extends ExternalRow>({
  section,
  rows,
  pageSize,
  variant = 'summary',
  facilityLabel,
}: ExternalRecordsTableProps<T>) {
  const { t } = useTranslation();
  const isTablet = useLayoutType() === 'tablet';
  const { results, goTo, currentPage } = usePagination(rows, pageSize);
  const isSummary = variant === 'summary';
  const columns = (isSummary && section.summaryColumns) || section.columns;
  const title = (isSummary && section.summaryTitle?.(t)) || section.title(t);
  const heading = isSummary ? title : `${title} (${rows.length})`;
  const emptyText = isSummary
    ? t('noSectionRows', 'No {{section}} from other facilities', { section: title.toLowerCase() })
    : t('noSectionRowsAt', 'No {{section}} recorded at {{facility}}', {
        section: section.noun(t),
        facility: facilityLabel ?? t('otherFacilities', 'other facilities'),
      });

  const rowNote = !isSummary ? section.rowNote?.(t) : undefined;
  const headers = [
    ...columns.map((column) => ({ key: column.key, header: column.header(t) })),
    { key: 'facility', header: t('facility', 'Facility') },
    ...(rowNote ? [{ key: 'rowNote', header: t('actions', 'Actions') }] : []),
  ];
  const tableRows = results.map((row) => ({
    id: row.id,
    ...Object.fromEntries(columns.map((column) => [column.key, column.value(row, formatIso)])),
    facility: row.facility.name ?? t('unknownFacility', 'Unknown facility'),
    ...(rowNote ? { rowNote } : {}),
  }));

  return (
    <div className={styles.widget}>
      {/* On the dashboard the page header already says External · Read-only (5a). */}
      <CardHeader title={heading}>{isSummary && <ExternalTags />}</CardHeader>
      {!isSummary && section.note && <p className={styles.note}>{section.note(t)}</p>}
      {rows.length === 0 ? (
        <ExternalEmptyRows text={emptyText} />
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
                          <TableCell
                            key={cell.id}
                            className={
                              cell.info.header === 'facility'
                                ? styles.facility
                                : cell.info.header === 'rowNote'
                                  ? styles.rowNote
                                  : ''
                            }
                          >
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
