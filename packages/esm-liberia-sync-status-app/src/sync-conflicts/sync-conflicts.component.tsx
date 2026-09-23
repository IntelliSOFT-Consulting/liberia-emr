import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  Tile,
  Toggle,
} from '@carbon/react';
import { formatDate } from '@openmrs/esm-framework';
import {
  type Conflict,
  type Decision,
  type DecisionChoice,
  recordDecision,
  useConflictDetail,
  useSyncConflicts,
} from './sync-conflicts.resource';
import styles from './sync-conflicts.scss';

const reasonMaxLength = 500;

function when(millis: number | null) {
  return millis ? formatDate(new Date(millis)) : '';
}

/** HH:MM-HH:MM with the same time at both ends means the receiver applies at any time of day. */
function appliesAnyTime(window: string | null | undefined) {
  if (!window) {
    return false;
  }
  const [from, to] = window.split('-');
  return from === to;
}

/**
 * Sync conflicts at central: a facility's update held back because central's copy of the record
 * was changed outside sync. A reviewer compares the two versions and records which one is right;
 * the receiver applies decided conflicts in its window, with dbsync's own procedure.
 */
const SyncConflicts: React.FC = () => {
  const { t } = useTranslation();
  const { conflicts, error, isLoading, mutate } = useSyncConflicts();
  const [selected, setSelected] = useState<Conflict | null>(null);
  const [applied, setApplied] = useState<Conflict | null>(null);

  // The receiver removes a conflict once it has applied the decision. When the one under review
  // goes, say so and close it, rather than leave a panel about a conflict that no longer exists.
  const list = conflicts?.conflicts;
  useEffect(() => {
    if (selected && list && !list.some((conflict) => conflict.id === selected.id)) {
      setApplied(selected);
      setSelected(null);
    }
  }, [list, selected]);

  if (isLoading) {
    return <InlineLoading className={styles.container} description={t('loadingConflicts', 'Loading sync conflicts...')} />;
  }

  if (error?.response?.status === 403) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('conflictsNotPermitted', 'You do not have permission to review sync conflicts')}
          subtitle={t('askForConflictPrivilege', 'Ask ICT for the Resolve Sync Conflicts privilege.')}
        />
      </div>
    );
  }

  if (error || !conflicts?.enabled) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('conflictsNotAvailableHere', 'Sync conflicts are not available on this server')}
          subtitle={t('conflictsCentralOnly', 'Conflicts are reviewed at central, where facility records are received.')}
        />
      </div>
    );
  }

  const waiting = list ?? [];
  const recent = conflicts.recent ?? [];

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('syncConflicts', 'Sync conflicts')}</h3>
      <p className={styles.explainer}>
        {t(
          'conflictsExplainer',
          "A facility's update to a record was held back because the record was changed here, outside sync. Compare the two versions with the facility's clinical owner and record which one is right.",
        )}
      </p>
      <p className={styles.explainer}>
        {appliesAnyTime(conflicts.applyWindow)
          ? t(
              'applyAnyTime',
              'Decisions are applied within minutes, at any time of day. Sync pauses briefly while that happens. A table is applied once every conflict in it is decided.',
            )
          : conflicts.applyWindow
          ? t(
              'applyWindowExplainer',
              'Decisions are applied between {{window}} UTC. Sync pauses briefly while that happens. A table is applied once every conflict in it is decided.',
              { window: conflicts.applyWindow },
            )
          : t('noApplyWindow', 'Decisions are not applied automatically on this server. ICT applies them by hand.')}
      </p>

      {conflicts.available === false && (
        <InlineNotification
          className={styles.notice}
          kind="warning"
          lowContrast
          hideCloseButton
          title={t('queueUnreadable', 'The conflict queue cannot be read')}
          subtitle={t(
            'queueUnreadableBody',
            "The EMR's database account cannot read the receiver's schema yet. ICT grants it once, as the deployment runbook describes.",
          )}
        />
      )}

      {applied && (
        <InlineNotification
          className={styles.notice}
          kind="success"
          lowContrast
          onClose={() => setApplied(null)}
          title={t('conflictApplied', 'Conflict applied')}
          subtitle={t(
            'conflictAppliedBody',
            "The receiver applied the decision on {{table}} {{identifier}}. The facility's held updates reach central within a few minutes.",
            { table: applied.table, identifier: applied.identifier },
          )}
        />
      )}

      <TableContainer title={t('waitingForDecision', 'Conflicts waiting')}>
        <Table size="sm" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader>{t('record', 'Record')}</TableHeader>
              <TableHeader>{t('raised', 'Raised')}</TableHeader>
              <TableHeader>{t('updatesWaiting', 'Updates held behind it')}</TableHeader>
              <TableHeader>{t('state', 'State')}</TableHeader>
              <TableHeader />
            </TableRow>
          </TableHead>
          <TableBody>
            {waiting.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{t('noConflicts', 'No conflicts are waiting.')}</TableCell>
              </TableRow>
            ) : (
              waiting.map((conflict) => (
                <TableRow key={conflict.id} className={selected?.id === conflict.id ? styles.selectedRow : undefined}>
                  <TableCell>
                    {conflict.table} <span className={styles.identifier}>{conflict.identifier}</span>
                  </TableCell>
                  <TableCell>{when(conflict.raised)}</TableCell>
                  <TableCell>{conflict.waiting}</TableCell>
                  <TableCell>
                    <ConflictState conflict={conflict} anyTime={appliesAnyTime(conflicts.applyWindow)} />
                  </TableCell>
                  <TableCell>
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        setApplied(null);
                        setSelected(conflict);
                      }}
                    >
                      {conflict.decision ? t('view', 'View') : t('review', 'Review')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selected && (
        <ConflictReview
          key={selected.id}
          conflict={waiting.find((conflict) => conflict.id === selected.id) ?? selected}
          applyWindow={conflicts.applyWindow}
          onDecided={() => mutate()}
          onClose={() => setSelected(null)}
        />
      )}

      {recent.length > 0 && (
        <TableContainer className={styles.section} title={t('recentlyApplied', 'Applied in the last 30 days')}>
          <Table size="sm" useZebraStyles>
            <TableHead>
              <TableRow>
                <TableHeader>{t('record', 'Record')}</TableHeader>
                <TableHeader>{t('decision', 'Decision')}</TableHeader>
                <TableHeader>{t('reason', 'Reason')}</TableHeader>
                <TableHeader>{t('decidedBy', 'Decided by')}</TableHeader>
                <TableHeader>{t('applied', 'Applied')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.map((entry) => (
                <TableRow key={`${entry.conflictId}-${entry.dateDecided}`}>
                  <TableCell>
                    {entry.table} <span className={styles.identifier}>{entry.identifier}</span>
                  </TableCell>
                  <TableCell>
                    <DecisionLabel decision={entry.decision} />
                  </TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell>{entry.decidedBy}</TableCell>
                  <TableCell>{when(entry.dateApplied)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
};

const DecisionLabel: React.FC<{ decision: DecisionChoice }> = ({ decision }) => {
  const { t } = useTranslation();
  return (
    <>
      {decision === 'FACILITY_STANDS'
        ? t('facilityStands', "The facility's version is right")
        : t('centralRedoneAtFacility', "Central's change is right; the facility will make it too")}
    </>
  );
};

// Only the state that asks for action is a tag; Carbon truncates a tag's longer text.
const ConflictState: React.FC<{ conflict: Conflict; anyTime: boolean }> = ({ conflict, anyTime }) => {
  const { t } = useTranslation();
  if (!conflict.decision) {
    return <Tag type="red">{t('needsDecision', 'Needs a decision')}</Tag>;
  }
  if (conflict.decision.applyError) {
    return <span className={styles.stateText}>{t('applyFailed', 'Applying failed; tried again in the next window')}</span>;
  }
  if (conflict.undecidedInTable > 0) {
    return (
      <span className={styles.stateText}>
        {t('waitingOnOthers', 'Decided; waiting for {{count}} other conflict(s) in {{table}}', {
          count: conflict.undecidedInTable,
          table: conflict.table,
        })}
      </span>
    );
  }
  return (
    <span className={styles.stateText}>
      {anyTime
        ? t('decidedSoon', 'Decided; applied within minutes')
        : t('decidedPending', 'Decided; applied in the next window')}
    </span>
  );
};

interface ConflictReviewProps {
  conflict: Conflict;
  applyWindow: string | null | undefined;
  onDecided: () => void;
  onClose: () => void;
}

const ConflictReview: React.FC<ConflictReviewProps> = ({ conflict, applyWindow, onDecided, onClose }) => {
  const { t } = useTranslation();
  const { detail, error, isLoading, mutate } = useConflictDetail(conflict.id);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return <InlineLoading description={t('loadingConflict', 'Loading the two versions...')} />;
  }

  if (error || !detail) {
    return (
      <InlineNotification
        className={styles.section}
        kind="info"
        lowContrast
        onClose={onClose}
        title={
          error?.response?.status === 404
            ? t('conflictGone', 'This conflict has been applied already')
            : t('conflictUnreadable', 'This conflict cannot be read')
        }
      />
    );
  }

  // Decisions arrive newest first. One not yet applied is the decision that stands.
  const pending = detail.decisions.find((decision) => !decision.dateApplied) ?? null;
  const earlier = detail.decisions.filter((decision) => decision !== pending);
  const fields = showAll ? detail.fields : detail.fields.filter((field) => field.differs);

  return (
    <Tile className={styles.review}>
      <section aria-label={t('reviewConflict', 'Review conflict')}>
        <div className={styles.reviewHeader}>
          <div>
            <h4 className={styles.subheading}>
              {detail.table} <span className={styles.identifier}>{detail.identifier}</span>
            </h4>
            <p className={styles.meta}>
              {detail.facility
                ? t('sentBy', 'Sent by {{facility}}. Raised {{raised}}.', {
                    facility: detail.facility,
                    raised: when(detail.raised),
                  })
                : t('raisedAt', 'Raised {{raised}}.', { raised: when(detail.raised) })}
            </p>
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t('close', 'Close')}
          </Button>
        </div>

        {detail.centralMissing && (
          <InlineNotification
            className={styles.notice}
            kind="warning"
            lowContrast
            hideCloseButton
            title={t('centralMissing', 'Central no longer has this record')}
            subtitle={t('centralMissingBody', 'It was removed here outside sync. Deciding lets the facility send it again.')}
          />
        )}

        <div className={styles.comparisonHeader}>
          <h5 className={styles.label}>{t('twoVersions', 'The two versions')}</h5>
          <Toggle
            id={`show-all-${detail.id}`}
            size="sm"
            labelText={t('showAllFields', 'Show all fields')}
            hideLabel
            labelA={t('onlyDifferences', 'Only fields that differ')}
            labelB={t('allFields', 'All fields')}
            toggled={showAll}
            onToggle={setShowAll}
          />
        </div>
        <Table size="sm" className={styles.comparison}>
          <TableHead>
            <TableRow>
              <TableHeader>{t('field', 'Field')}</TableHeader>
              <TableHeader>{t('facilityVersion', "Facility's version")}</TableHeader>
              <TableHeader>{t('centralVersion', "Central's version")}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  {t('noDifferences', 'No field differs in value. Show all fields to see the record.')}
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field) => (
                <TableRow key={field.field} className={field.differs ? styles.differs : undefined}>
                  <TableCell>{field.field}</TableCell>
                  <TableCell>{field.facility ?? '—'}</TableCell>
                  <TableCell>{field.compared ? field.central ?? '—' : t('notCompared', 'Not compared')}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {pending && !editing ? (
          <DecisionSummary
            decision={pending}
            waitingOnOthers={conflict.undecidedInTable}
            table={detail.table}
            applyWindow={applyWindow}
            onChange={() => setEditing(true)}
          />
        ) : (
          <DecisionForm
            conflictId={detail.id}
            identifier={detail.identifier}
            replacing={pending}
            onCancel={pending ? () => setEditing(false) : undefined}
            onRecorded={async () => {
              setEditing(false);
              await mutate();
              onDecided();
            }}
          />
        )}

        {earlier.length > 0 && (
          <div className={styles.history}>
            <h5 className={styles.label}>{t('earlierDecisions', 'Earlier decisions')}</h5>
            {earlier.map((decision, index) => (
              <p key={index} className={styles.meta}>
                <DecisionLabel decision={decision.decision} />: {decision.reason} ({decision.decidedBy},{' '}
                {when(decision.dateDecided)})
              </p>
            ))}
          </div>
        )}
      </section>
    </Tile>
  );
};

interface DecisionSummaryProps {
  decision: Decision;
  waitingOnOthers: number;
  table: string | null;
  applyWindow: string | null | undefined;
  onChange: () => void;
}

/** The decision that stands, once recorded: what was decided, and what happens next. */
const DecisionSummary: React.FC<DecisionSummaryProps> = ({ decision, waitingOnOthers, table, applyWindow, onChange }) => {
  const { t } = useTranslation();

  let next: string;
  if (decision.applyError) {
    next = t('nextAfterFailure', 'Applying it failed at {{time}}. The receiver tries again in the next window.', {
      time: when(decision.dateApplyFailed),
    });
  } else if (waitingOnOthers > 0) {
    next = t(
      'nextAfterOthers',
      'It is applied once the {{count}} other conflict(s) in {{table}} are decided too, because the whole table is applied at once.',
      { count: waitingOnOthers, table },
    );
  } else if (appliesAnyTime(applyWindow)) {
    next = t('nextSoon', 'The receiver applies it within a few minutes. This page updates when it has.');
  } else if (applyWindow) {
    next = t('nextInWindow', 'The receiver applies it between {{window}} UTC. This page updates when it has.', {
      window: applyWindow,
    });
  } else {
    next = t('nextByHand', 'ICT applies it by hand on this server.');
  }

  return (
    <div className={styles.summary}>
      <InlineNotification
        kind={decision.applyError ? 'warning' : 'success'}
        lowContrast
        hideCloseButton
        title={t('decisionRecorded', 'Decision recorded')}
        subtitle={next}
      />
      <dl className={styles.summaryList}>
        <dt>{t('decision', 'Decision')}</dt>
        <dd>
          <DecisionLabel decision={decision.decision} />
        </dd>
        <dt>{t('reason', 'Reason')}</dt>
        <dd>{decision.reason}</dd>
        <dt>{t('decidedBy', 'Decided by')}</dt>
        <dd>
          {decision.decidedBy}, {when(decision.dateDecided)}
        </dd>
      </dl>
      <Button kind="tertiary" size="sm" onClick={onChange}>
        {t('changeDecision', 'Change decision')}
      </Button>
    </div>
  );
};

interface DecisionFormProps {
  conflictId: number;
  identifier: string;
  replacing: Decision | null;
  onCancel?: () => void;
  onRecorded: () => void;
}

const DecisionForm: React.FC<DecisionFormProps> = ({ conflictId, identifier, replacing, onCancel, onRecorded }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<DecisionChoice | ''>(replacing?.decision ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    if (!choice || !reason.trim()) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await recordDecision(conflictId, identifier, choice, reason.trim());
      onRecorded();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setSaveError(
        status === 404 || status === 409
          ? t('decisionStale', 'This conflict changed while you were reviewing it. Reload the page and review it again.')
          : t('decisionFailed', 'The decision was not recorded. Try again.'),
      );
      setSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <h5 className={styles.label}>
        {replacing ? t('changeTheDecision', 'Change the decision') : t('recordADecision', 'Record a decision')}
      </h5>
      {saveError && <InlineNotification className={styles.notice} kind="error" lowContrast hideCloseButton title={saveError} />}
      <RadioButtonGroup
        legendText={t('whichIsRight', 'Which version is right?')}
        name={`decision-${conflictId}`}
        orientation="vertical"
        valueSelected={choice}
        onChange={(value) => setChoice(value as DecisionChoice)}
      >
        <RadioButton
          id={`facility-stands-${conflictId}`}
          value="FACILITY_STANDS"
          labelText={t('facilityStandsLong', "The facility's version is right. Central's change is replaced.")}
        />
        <RadioButton
          id={`central-redone-${conflictId}`}
          value="CENTRAL_REDONE_AT_FACILITY"
          labelText={t(
            'centralRedoneLong',
            "Central's change is right. The facility will make the same change, and until it does the facility's version is shown here.",
          )}
        />
      </RadioButtonGroup>
      <TextArea
        id={`reason-${conflictId}`}
        className={styles.reason}
        rows={3}
        labelText={t('reasonLabel', 'Reason')}
        helperText={t('reasonHelper', "Who you agreed this with and why. Do not write a patient's name or identifier.")}
        maxCount={reasonMaxLength}
        enableCounter
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        {onCancel && (
          <Button kind="secondary" size="sm" onClick={onCancel} disabled={saving}>
            {t('cancel', 'Cancel')}
          </Button>
        )}
        <Button kind="primary" size="sm" disabled={!choice || !reason.trim() || saving} onClick={submit}>
          {saving ? t('recording', 'Recording...') : t('recordDecision', 'Record decision')}
        </Button>
      </div>
    </div>
  );
};

export default SyncConflicts;
