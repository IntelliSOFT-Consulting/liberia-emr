import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  DataTable,
  InlineLoading,
  InlineNotification,
  Pagination,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { useConfig } from '@openmrs/esm-framework';
import type { AuditLogConfig } from '../config-schema';
import {
  type AuditAction,
  type AuditFilters,
  type AuditLogError,
  exportUrl,
  statusOf,
  useAuditLog,
  useAuditTypes,
} from './audit-log.resource';
import AuditEntryDetail from './audit-entry-detail.component';
import { ActionTag, formatDate, userLabel } from './audit-log.shared';
import styles from './audit-log.scss';

const SERVER_MAX_PAGE = 200;
const SERVER_MAX_EXPORT = 50000;

function ErrorNotice({ error }: { error: AuditLogError }) {
  const { t } = useTranslation();
  const status = statusOf(error);
  if (status === 403 || status === 401) {
    return (
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title={t('notPermitted', 'You cannot read the audit log')}
        subtitle={t('askForRole', 'Reading it needs the Get Audit Logs privilege. Ask the ICT Unit for the ICT Auditor role.')}
      />
    );
  }
  if (status === 503) {
    return (
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title={t('notRecorded', 'The audit log is not recorded on this server')}
        subtitle={t('notRecordedBody', 'The auditlog module is not installed or has not started. Contact ICT.')}
      />
    );
  }
  return (
    <InlineNotification
      kind="error"
      lowContrast
      hideCloseButton
      title={t('loadFailed', 'The audit log could not be loaded')}
      subtitle={error?.responseBody?.error ?? error?.message}
    />
  );
}

/**
 * The ICT Unit's audit log (MOH ICT SOP control B3): every create, update and delete the auditlog
 * module recorded on this server, newest first, filtered and paged by the server, with one entry's
 * previous and current values beside the table and a CSV download of the same filters.
 */
const AuditLog: React.FC = () => {
  const { t } = useTranslation();
  const config = useConfig<AuditLogConfig>();
  const [draft, setDraft] = useState<AuditFilters>({ action: '' });
  const [filters, setFilters] = useState<AuditFilters>({ action: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(Math.min(config?.pageSize ?? 50, SERVER_MAX_PAGE));
  const [selected, setSelected] = useState<string | null>(null);
  const { types } = useAuditTypes();
  const { page: result, error, isLoading, isValidating } = useAuditLog(filters, (page - 1) * pageSize, pageSize);

  const exportLimit = Math.min(Math.max(1, config?.exportRowLimit ?? SERVER_MAX_EXPORT), SERVER_MAX_EXPORT);
  const pageSizes = (config?.pageSizes?.length ? config.pageSizes : [25, 50, 100, 200]).map((size) =>
    Math.min(size, SERVER_MAX_PAGE),
  );

  const apply = (event?: React.FormEvent) => {
    event?.preventDefault();
    setFilters({ ...draft });
    setPage(1);
    setSelected(null);
  };

  const reset = () => {
    setDraft({ action: '' });
    setFilters({ action: '' });
    setPage(1);
    setSelected(null);
  };

  const headers = [
    { key: 'date', header: t('date', 'Date') },
    { key: 'action', header: t('action', 'Action') },
    { key: 'type', header: t('type', 'Type') },
    { key: 'identifier', header: t('identifier', 'Identifier') },
    { key: 'user', header: t('user', 'User') },
  ];
  const entries = result?.results ?? [];
  const rows = entries.map((entry) => ({ id: entry.uuid, ...entry }));
  const byUuid = new Map(entries.map((entry) => [entry.uuid, entry]));
  const total = result?.totalCount ?? 0;

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('auditLog', 'Audit log')}</h3>
      <p className={styles.explainer}>
        {t(
          'explainer',
          'Every record created, changed or deleted on this server, who did it and when. Entries show previous and current values, which can include patient details: treat what you read and export here as confidential.',
        )}
      </p>

      <form className={styles.filters} onSubmit={apply} aria-label={t('filters', 'Filters')}>
        <TextInput
          id="audit-from"
          type="date"
          labelText={t('from', 'From')}
          value={draft.from ?? ''}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        <TextInput
          id="audit-to"
          type="date"
          labelText={t('to', 'To')}
          value={draft.to ?? ''}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        <TextInput
          id="audit-user"
          labelText={t('user', 'User')}
          placeholder={t('userPlaceholder', 'Username or system ID')}
          value={draft.user ?? ''}
          onChange={(event) => setDraft({ ...draft, user: event.target.value })}
        />
        <Select
          id="audit-type"
          labelText={t('type', 'Type')}
          value={draft.type ?? ''}
          onChange={(event) => setDraft({ ...draft, type: event.target.value })}
        >
          <SelectItem value="" text={t('allTypes', 'All types')} />
          {types.map((type) => (
            <SelectItem key={type.type} value={type.type} text={`${type.name} (${type.type})`} />
          ))}
        </Select>
        <Select
          id="audit-action"
          labelText={t('action', 'Action')}
          value={draft.action ?? ''}
          onChange={(event) => setDraft({ ...draft, action: event.target.value as AuditAction | '' })}
        >
          <SelectItem value="" text={t('allActions', 'All actions')} />
          <SelectItem value="CREATED" text={t('created', 'Created')} />
          <SelectItem value="UPDATED" text={t('updated', 'Updated')} />
          <SelectItem value="DELETED" text={t('deleted', 'Deleted')} />
        </Select>
        <Checkbox
          id="audit-top-level"
          labelText={t('topLevelOnly', 'Hide entries saved as part of another (a patient’s name, for one)')}
          checked={!!draft.topLevelOnly}
          onChange={(_event, { checked }) => setDraft({ ...draft, topLevelOnly: checked })}
        />
        <div className={styles.filterActions}>
          <Button type="submit" size="md">
            {t('apply', 'Apply filters')}
          </Button>
          <Button kind="secondary" size="md" onClick={reset}>
            {t('reset', 'Reset')}
          </Button>
          {error ? null : (
            // A plain link, styled as a button: the browser sends the session cookie and saves the
            // streamed file itself, so a large export is never held in the page.
            <a className="cds--btn cds--btn--tertiary cds--btn--md" href={exportUrl(filters, exportLimit)} download data-testid="audit-export">
              {t('downloadCsv', 'Download CSV')}
            </a>
          )}
        </div>
      </form>
      <p className={styles.helper}>
        {t('exportNote', 'The download uses the applied filters, newest first, up to {{limit}} rows.', {
          limit: exportLimit.toLocaleString(),
        })}
      </p>

      {error ? (
        <ErrorNotice error={error} />
      ) : isLoading && !result ? (
        <InlineLoading description={t('loading', 'Loading…')} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.tableColumn}>
            <p className={styles.helper} data-testid="audit-total">
              {t('matching', '{{count}} matching entries', { count: total })}
              {isValidating ? ' …' : ''}
            </p>
            {entries.length === 0 ? (
              <p className={styles.empty}>{t('noEntries', 'No audit log entries match these filters.')}</p>
            ) : (
              <DataTable rows={rows} headers={headers} size="sm" useZebraStyles>
                {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} aria-label={t('auditLog', 'Audit log')}>
                      <TableHead>
                        <TableRow>
                          {tableHeaders.map((header) => {
                            const { key, ...headerProps } = getHeaderProps({ header });
                            return (
                              <TableHeader key={key} {...headerProps}>
                                {header.header}
                              </TableHeader>
                            );
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tableRows.map((row) => {
                          const entry = byUuid.get(row.id);
                          const { key, ...rowProps } = getRowProps({ row });
                          return (
                            <TableRow
                              key={key}
                              {...rowProps}
                              data-testid="audit-row"
                              className={selected === row.id ? styles.selectedRow : styles.row}
                              onClick={() => setSelected(row.id)}
                            >
                              <TableCell>
                                <button
                                  type="button"
                                  className={styles.linkButton}
                                  onClick={() => setSelected(row.id)}
                                  aria-label={t('openEntry', 'Open entry {{identifier}}', {
                                    identifier: entry.identifier,
                                  })}
                                >
                                  {formatDate(entry.dateCreated)}
                                </button>
                              </TableCell>
                              <TableCell>
                                <ActionTag action={entry.action} />
                              </TableCell>
                              <TableCell title={entry.type}>
                                {entry.typeName}
                                {entry.parentUuid ? (
                                  <span className={styles.helper}> {t('childEntry', '(part of another entry)')}</span>
                                ) : null}
                              </TableCell>
                              <TableCell>{entry.identifier}</TableCell>
                              <TableCell>{userLabel(entry, t('system', 'System'))}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
            <Pagination
              page={page}
              pageSize={pageSize}
              pageSizes={pageSizes}
              totalItems={total}
              onChange={({ page: nextPage, pageSize: nextSize }) => {
                if (nextSize !== pageSize) {
                  setPageSize(nextSize);
                  setPage(1);
                } else {
                  setPage(nextPage);
                }
              }}
            />
          </div>
          <div className={styles.detailColumn}>
            {selected ? (
              <AuditEntryDetail uuid={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
            ) : (
              <p className={styles.helper}>{t('selectEntry', 'Select an entry to see what changed.')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLog;
