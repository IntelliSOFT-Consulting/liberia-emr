import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  Pagination,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from '@carbon/react';
import { itemsPageSize, statusOf, useMflRun, useMflRunItems } from './mfl-sync.resource';
import { type MflItemAction, type MflRunItem } from './mfl-sync.types';
import { RunCounts, RunStatusTag, when } from './mfl-run-summary.component';
import styles from './mfl-sync.scss';

const actions: Array<MflItemAction> = ['CREATE', 'UPDATE', 'RETIRE', 'UNRETIRE', 'WARNING', 'ERROR'];

interface MflRunDetailProps {
  runId: number;
  onClose: () => void;
}

/** One run's per-location changes, warnings and errors. Unchanged locations without a warning are not recorded. */
const MflRunDetail: React.FC<MflRunDetailProps> = ({ runId, onClose }) => {
  const { t } = useTranslation();
  const { run, error, isLoading } = useMflRun(runId);
  const [action, setAction] = useState<MflItemAction | null>(null);
  const [start, setStart] = useState(0);
  const { items, isLoading: itemsLoading } = useMflRunItems(runId, action, start);

  if (isLoading) {
    return <InlineLoading description={t('loadingRun', 'Loading the run...')} />;
  }

  if (error || !run) {
    return (
      <InlineNotification
        className={styles.section}
        kind="info"
        lowContrast
        onClose={onClose}
        title={statusOf(error) === 404 ? t('runNotFound', 'This run no longer exists') : t('runUnreadable', 'This run cannot be read')}
      />
    );
  }

  const results = items?.results ?? [];

  return (
    <Tile className={styles.review}>
      <section aria-label={t('runDetail', 'Run detail')}>
        <div className={styles.reviewHeader}>
          <div>
            <h4 className={styles.subheading}>
              {run.dryRun ? t('dryRunOf', 'Dry run of {{time}}', { time: when(run.started) }) : t('syncOf', 'Sync of {{time}}', { time: when(run.started) })}{' '}
              <RunStatusTag run={run} />
            </h4>
            <p className={styles.meta}>
              <RunCounts run={run} />
            </p>
            {run.dryRun && (
              <p className={styles.meta}>{t('dryRunExplainer', 'A dry run changes nothing. These are the changes a sync would make.')}</p>
            )}
            {run.message && <p className={styles.meta}>{run.message}</p>}
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t('close', 'Close')}
          </Button>
        </div>

        <Select
          id={`mfl-action-${runId}`}
          className={styles.filter}
          labelText={t('show', 'Show')}
          inline
          value={action ?? ''}
          onChange={(event) => {
            setAction((event.target.value || null) as MflItemAction | null);
            setStart(0);
          }}
        >
          <SelectItem value="" text={t('allItems', 'Everything recorded')} />
          {actions.map((value) => (
            <SelectItem key={value} value={value} text={actionLabel(value, t)} />
          ))}
        </Select>

        <Table size="sm" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader>{t('location', 'Location')}</TableHeader>
              <TableHeader>{t('action', 'Action')}</TableHeader>
              <TableHeader>{t('whatChanged', 'What changed')}</TableHeader>
              <TableHeader>{t('warningsAndErrors', 'Warnings and errors')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {itemsLoading ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <InlineLoading description={t('loadingItems', 'Loading changes...')} />
                </TableCell>
              </TableRow>
            ) : results.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>{t('noItems', 'Nothing to show: every location was unchanged.')}</TableCell>
              </TableRow>
            ) : (
              results.map((item, index) => <ItemRow key={`${item.mflUid}-${index}`} item={item} />)
            )}
          </TableBody>
        </Table>
        {(items?.totalCount ?? 0) > itemsPageSize && (
          <Pagination
            page={Math.floor(start / itemsPageSize) + 1}
            pageSize={itemsPageSize}
            pageSizes={[itemsPageSize]}
            totalItems={items.totalCount}
            onChange={({ page }) => setStart((page - 1) * itemsPageSize)}
          />
        )}
      </section>
    </Tile>
  );
};

function actionLabel(action: MflItemAction, t: (key: string, fallback: string) => string) {
  switch (action) {
    case 'CREATE':
      return t('actionCreate', 'Created');
    case 'UPDATE':
      return t('actionUpdate', 'Updated');
    case 'RETIRE':
      return t('actionRetire', 'Retired');
    case 'UNRETIRE':
      return t('actionUnretire', 'Restored');
    case 'WARNING':
      return t('actionWarning', 'Unchanged, with warnings');
    default:
      return t('actionError', 'Failed');
  }
}

const actionTagType: Record<MflItemAction, 'green' | 'blue' | 'magenta' | 'teal' | 'warm-gray' | 'red'> = {
  CREATE: 'green',
  UPDATE: 'blue',
  RETIRE: 'magenta',
  UNRETIRE: 'teal',
  WARNING: 'warm-gray',
  ERROR: 'red',
};

const ItemRow: React.FC<{ item: MflRunItem }> = ({ item }) => {
  const { t } = useTranslation();
  const level =
    item.level === 'COUNTY' ? t('county', 'County') : item.level === 'DISTRICT' ? t('district', 'District') : t('facility', 'Facility');

  return (
    <TableRow>
      <TableCell>
        <div>{item.name}</div>
        <div className={styles.meta}>
          {level} · <span className={styles.code}>{item.mflCode ?? item.mflUid}</span>
        </div>
      </TableCell>
      <TableCell>
        <Tag type={actionTagType[item.action]}>{actionLabel(item.action, t)}</Tag>
      </TableCell>
      <TableCell>
        {item.changes.length === 0 ? (
          '—'
        ) : (
          <ul className={styles.changes}>
            {item.changes.map((change) => (
              <li key={change.field}>
                <span className={styles.code}>{change.field}</span>:{' '}
                {change.from === null
                  ? change.to ?? '—'
                  : t('fromTo', '{{from}} → {{to}}', { from: change.from, to: change.to ?? '—' })}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        {item.error && <div className={styles.error}>{item.error}</div>}
        {item.warnings.length > 0 && (
          <ul className={styles.changes}>
            {item.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {!item.error && item.warnings.length === 0 && '—'}
      </TableCell>
    </TableRow>
  );
};

export default MflRunDetail;
