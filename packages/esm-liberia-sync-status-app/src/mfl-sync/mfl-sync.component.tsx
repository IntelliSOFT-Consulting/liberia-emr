import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from '@carbon/react';
import { useSession, userHasAccess } from '@openmrs/esm-framework';
import {
  messageOf,
  runsPageSize,
  startMflRun,
  statusOf,
  testMflConnection,
  useMflRuns,
  useMflStatus,
} from './mfl-sync.resource';
import { type MflConnectionTest, type MflRun, type MflStatus } from './mfl-sync.types';
import MflSettings from './mfl-settings.component';
import MflRunDetail from './mfl-run-detail.component';
import { RunCounts, RunStatusTag, when } from './mfl-run-summary.component';
import styles from './mfl-sync.scss';

export const managePrivilege = 'Manage MFL Sync';

/**
 * The MFL sync admin page (ADR 0009 decision 9): what the Master Facility List sync holds, when it
 * runs, what each run changed, and the settings an administrator may edit. The credentials are a
 * deployment secret, so nothing here reads or writes them.
 */
const MflSync: React.FC = () => {
  const { t } = useTranslation();
  const session = useSession();
  const canManage = userHasAccess(managePrivilege, session?.user);
  const { status, error, isLoading, mutate } = useMflStatus();
  const [runsStart, setRunsStart] = useState(0);
  const { runs, mutate: mutateRuns } = useMflRuns(runsStart, Boolean(status?.running));
  const [selectedRun, setSelectedRun] = useState<number | null>(null);

  if (isLoading) {
    return <InlineLoading className={styles.container} description={t('loadingMflSync', 'Loading the MFL sync...')} />;
  }

  if (statusOf(error) === 403) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('mflNotPermitted', 'You do not have permission to view the MFL sync')}
          subtitle={t('askForMflPrivilege', 'Ask ICT for the View MFL Sync privilege.')}
        />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('mflNotReadable', 'The MFL sync cannot be read on this server')}
          subtitle={t('mflNotReadableBody', 'The EMR did not answer. Reload the page, or ask ICT to check the server.')}
        />
      </div>
    );
  }

  const refresh = () => {
    mutate();
    mutateRuns();
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('mflSync', 'Master Facility List sync')}</h3>
      <p className={styles.explainer}>
        {t(
          'mflExplainer',
          "Copies the Ministry of Health's Master Facility List into this EMR as counties, districts and facilities, so they can be chosen as locations. The MFL owns their names, places and types; wards and departments stay local.",
        )}
      </p>

      {!status.available && (
        <InlineNotification
          className={styles.notice}
          kind="warning"
          lowContrast
          hideCloseButton
          title={t('mflUnavailable', 'The MFL sync is not set up on this server')}
          subtitle={t(
            'mflUnavailableBody',
            'No MFL account is configured, so nothing can be fetched. ICT sets the account as a deployment secret; settings saved here take effect once it is.',
          )}
        />
      )}

      <StatusPanel status={status} />

      {canManage && <Actions status={status} onStarted={refresh} />}

      <MflSettings status={status} canManage={canManage} onSaved={(next) => mutate({ data: next }, false)} />

      <RunHistory
        runs={runs?.results ?? []}
        totalCount={runs?.totalCount ?? 0}
        startIndex={runsStart}
        onPage={setRunsStart}
        selected={selectedRun}
        onSelect={setSelectedRun}
      />

      {selectedRun !== null && (
        <MflRunDetail key={selectedRun} runId={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
};

const StatusPanel: React.FC<{ status: MflStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const { config, held, running, lastRun, lastSuccessfulRun } = status;

  return (
    <Tile className={styles.panel}>
      <dl className={styles.facts}>
        <dt>{t('schedule', 'Schedule')}</dt>
        <dd>
          {config.enabled ? (
            <>
              <Tag type="green">{t('scheduleOn', 'On')}</Tag>
              {t('dailyAt', 'Daily at {{time}} (Monrovia time)', { time: config.schedule.time })}
            </>
          ) : (
            <Tag type="gray">{t('scheduleOff', 'Off: runs only when started here')}</Tag>
          )}
        </dd>
        {status.nextRun && (
          <>
            <dt>{t('nextRun', 'Next run')}</dt>
            <dd>{when(status.nextRun)}</dd>
          </>
        )}
        <dt>{t('mflUrl', 'MFL address')}</dt>
        <dd className={styles.code}>{config.url}</dd>
        <dt>{t('mflAccount', 'MFL account')}</dt>
        <dd>{config.username ?? t('notConfigured', 'Not configured')}</dd>
        <dt>{t('held', 'Held here')}</dt>
        <dd>
          {t('heldCounts', '{{counties}} counties, {{districts}} districts, {{facilities}} facilities ({{retired}} retired)', held)}
        </dd>
        {running && (
          <>
            <dt>{t('inProgress', 'In progress')}</dt>
            <dd>
              <InlineLoading
                description={
                  running.dryRun
                    ? t('dryRunSince', 'Dry run started {{time}}', { time: when(running.started) })
                    : t('runSince', 'Sync started {{time}}', { time: when(running.started) })
                }
              />
            </dd>
          </>
        )}
        <dt>{t('lastRun', 'Last run')}</dt>
        <dd>
          {lastRun ? (
            <>
              <RunStatusTag run={lastRun} /> {when(lastRun.finished ?? lastRun.started)}
              {lastRun.dryRun && <span className={styles.meta}> {t('dryRunNote', '(dry run)')}</span>}
              <div>
                <RunCounts run={lastRun} />
              </div>
              {lastRun.message && <div className={styles.meta}>{lastRun.message}</div>}
            </>
          ) : (
            t('neverRun', 'Never')
          )}
        </dd>
        {lastSuccessfulRun && lastSuccessfulRun.id !== lastRun?.id && (
          <>
            <dt>{t('lastSuccessfulRun', 'Last successful run')}</dt>
            <dd>{when(lastSuccessfulRun.finished ?? lastSuccessfulRun.started)}</dd>
          </>
        )}
      </dl>
    </Tile>
  );
};

const Actions: React.FC<{ status: MflStatus; onStarted: () => void }> = ({ status, onStarted }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'test' | 'dry' | 'sync' | null>(null);
  const [test, setTest] = useState<MflConnectionTest | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; title: string } | null>(null);
  const disabled = !status.available || busy !== null;

  const unavailable = t('mflUnavailable', 'The MFL sync is not set up on this server');

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    setNotice(null);
    try {
      const response = await testMflConnection();
      setTest(response.data);
    } catch (e) {
      setNotice({
        kind: 'error',
        title: statusOf(e) === 503 ? unavailable : messageOf(e) ?? t('testFailed', 'The connection test could not be run.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'sync');
    setTest(null);
    setNotice(null);
    try {
      await startMflRun(dryRun);
      setNotice({
        kind: 'success',
        title: dryRun
          ? t('dryRunStarted', 'Dry run started. It changes nothing; open it below when it finishes to see what a sync would do.')
          : t('syncStarted', 'Sync started. This page updates as it runs.'),
      });
      onStarted();
    } catch (e) {
      const code = statusOf(e);
      setNotice({
        kind: code === 409 ? 'info' : 'error',
        title:
          code === 409
            ? t('runInProgress', 'A run is already in progress. Wait for it to finish.')
            : code === 503
            ? unavailable
            : messageOf(e) ?? t('runNotStarted', 'The run was not started. Try again.'),
      });
      if (code === 409) {
        onStarted();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.section} aria-label={t('mflActions', 'MFL sync actions')}>
      <div className={styles.actions}>
        <Button kind="tertiary" size="sm" disabled={disabled} onClick={runTest}>
          {busy === 'test' ? t('testing', 'Testing...') : t('testConnection', 'Test connection')}
        </Button>
        <Button kind="secondary" size="sm" disabled={disabled || Boolean(status.running)} onClick={() => run(true)}>
          {busy === 'dry' ? t('starting', 'Starting...') : t('dryRun', 'Dry run')}
        </Button>
        <Button kind="primary" size="sm" disabled={disabled || Boolean(status.running)} onClick={() => run(false)}>
          {busy === 'sync' ? t('starting', 'Starting...') : t('syncNow', 'Sync now')}
        </Button>
      </div>
      {test && (
        <InlineNotification
          className={styles.notice}
          kind={test.ok ? 'success' : 'error'}
          lowContrast
          onClose={() => setTest(null)}
          title={test.ok ? t('connectionOk', 'Connected to the MFL') : t('connectionFailed', 'Could not connect to the MFL')}
          subtitle={
            test.ok
              ? t('connectionOkBody', 'DHIS2 {{version}}, {{facilities}} facilities.', {
                  version: test.dhis2Version,
                  facilities: test.facilities,
                })
              : test.message ?? ''
          }
        />
      )}
      {notice && (
        <InlineNotification
          className={styles.notice}
          kind={notice.kind}
          lowContrast
          onClose={() => setNotice(null)}
          title={notice.title}
        />
      )}
    </section>
  );
};

interface RunHistoryProps {
  runs: Array<MflRun>;
  totalCount: number;
  startIndex: number;
  onPage: (startIndex: number) => void;
  selected: number | null;
  onSelect: (id: number) => void;
}

const RunHistory: React.FC<RunHistoryProps> = ({ runs, totalCount, startIndex, onPage, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <TableContainer className={styles.section} title={t('runHistory', 'Run history')}>
      <Table size="sm" useZebraStyles>
        <TableHead>
          <TableRow>
            <TableHeader>{t('started', 'Started')}</TableHeader>
            <TableHeader>{t('kind', 'Kind')}</TableHeader>
            <TableHeader>{t('startedBy', 'Started by')}</TableHeader>
            <TableHeader>{t('result', 'Result')}</TableHeader>
            <TableHeader>{t('changes', 'Changes')}</TableHeader>
            <TableHeader />
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>{t('noRuns', 'The MFL has not been synced yet.')}</TableCell>
            </TableRow>
          ) : (
            runs.map((run) => (
              <TableRow key={run.id} className={selected === run.id ? styles.selectedRow : undefined}>
                <TableCell>{when(run.started)}</TableCell>
                <TableCell>{run.dryRun ? t('dryRun', 'Dry run') : t('sync', 'Sync')}</TableCell>
                <TableCell>{run.startedBy ?? t('schedule', 'Schedule')}</TableCell>
                <TableCell>
                  <RunStatusTag run={run} />
                </TableCell>
                <TableCell>
                  <RunCounts run={run} />
                </TableCell>
                <TableCell>
                  <Button kind="ghost" size="sm" onClick={() => onSelect(run.id)}>
                    {t('view', 'View')}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {totalCount > runsPageSize && (
        <Pagination
          page={Math.floor(startIndex / runsPageSize) + 1}
          pageSize={runsPageSize}
          pageSizes={[runsPageSize]}
          totalItems={totalCount}
          onChange={({ page }) => onPage((page - 1) * runsPageSize)}
        />
      )}
    </TableContainer>
  );
};

export default MflSync;
