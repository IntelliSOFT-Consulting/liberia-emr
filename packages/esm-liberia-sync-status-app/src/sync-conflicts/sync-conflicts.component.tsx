import React, { useState } from 'react';
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

/**
 * Sync conflicts at central: a facility's update held back because central's copy of the record
 * was changed outside sync. A reviewer compares the two versions and records which one is right;
 * the receiver applies decided conflicts in its nightly window, with dbsync's own procedure.
 */
const SyncConflicts: React.FC = () => {
  const { t } = useTranslation();
  const { conflicts, error, isLoading, mutate } = useSyncConflicts();
  const [selected, setSelected] = useState<Conflict | null>(null);

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

  const list = conflicts.conflicts ?? [];
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
        {conflicts.applyWindow && conflicts.applyWindow.split('-')[0] === conflicts.applyWindow.split('-')[1]
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
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{t('noConflicts', 'No conflicts are waiting.')}</TableCell>
              </TableRow>
            ) : (
              list.map((conflict) => (
                <TableRow key={conflict.id}>
                  <TableCell>
                    {conflict.table} <span className={styles.identifier}>{conflict.identifier}</span>
                  </TableCell>
                  <TableCell>{when(conflict.raised)}</TableCell>
                  <TableCell>{conflict.waiting}</TableCell>
                  <TableCell>
                    <ConflictState conflict={conflict} />
                  </TableCell>
                  <TableCell>
                    <Button kind="ghost" size="sm" onClick={() => setSelected(conflict)}>
                      {t('review', 'Review')}
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
          conflict={selected}
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
              {recent.map((applied) => (
                <TableRow key={`${applied.conflictId}-${applied.dateDecided}`}>
                  <TableCell>
                    {applied.table} <span className={styles.identifier}>{applied.identifier}</span>
                  </TableCell>
                  <TableCell>
                    <DecisionLabel decision={applied.decision} />
                  </TableCell>
                  <TableCell>{applied.reason}</TableCell>
                  <TableCell>{applied.decidedBy}</TableCell>
                  <TableCell>{when(applied.dateApplied)}</TableCell>
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
const ConflictState: React.FC<{ conflict: Conflict }> = ({ conflict }) => {
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
  return <span className={styles.stateText}>{t('decidedPending', 'Decided; applied in the next window')}</span>;
};

interface ConflictReviewProps {
  conflict: Conflict;
  onDecided: () => void;
  onClose: () => void;
}

const ConflictReview: React.FC<ConflictReviewProps> = ({ conflict, onDecided, onClose }) => {
  const { t } = useTranslation();
  const { detail, error, isLoading, mutate } = useConflictDetail(conflict.id);
  const [showAll, setShowAll] = useState(false);
  const [choice, setChoice] = useState<DecisionChoice | ''>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const fields = showAll ? detail.fields : detail.fields.filter((field) => field.differs);

  const submit = async () => {
    if (!choice || !reason.trim()) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await recordDecision(detail.id, detail.identifier, choice, reason.trim());
      setSaved(true);
      setReason('');
      setChoice('');
      await mutate();
      onDecided();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setSaveError(
        status === 404 || status === 409
          ? t('decisionStale', 'This conflict changed while you were reviewing it. Reload the page and review it again.')
          : t('decisionFailed', 'The decision was not recorded. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.section} aria-label={t('reviewConflict', 'Review conflict')}>
      <div className={styles.reviewHeader}>
        <h4 className={styles.subheading}>
          {detail.table} <span className={styles.identifier}>{detail.identifier}</span>
        </h4>
        <Button kind="ghost" size="sm" onClick={onClose}>
          {t('close', 'Close')}
        </Button>
      </div>
      <p className={styles.explainer}>
        {detail.facility
          ? t('sentBy', 'Sent by {{facility}}. Raised {{raised}}.', { facility: detail.facility, raised: when(detail.raised) })
          : t('raisedAt', 'Raised {{raised}}.', { raised: when(detail.raised) })}
      </p>

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

      <Toggle
        id={`show-all-${detail.id}`}
        size="sm"
        labelText=""
        labelA={t('onlyDifferences', 'Only fields that differ')}
        labelB={t('allFields', 'All fields')}
        toggled={showAll}
        onToggle={setShowAll}
      />

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
              <TableCell colSpan={3}>{t('noDifferences', 'No field differs in value. Show all fields to see the record.')}</TableCell>
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

      {detail.decisions.length > 0 && (
        <div className={styles.history}>
          <h5 className={styles.label}>{t('decisionsRecorded', 'Decisions recorded')}</h5>
          {detail.decisions.map((decision: Decision, index) => (
            <p key={index} className={styles.explainer}>
              <DecisionLabel decision={decision.decision} />: {decision.reason} ({decision.decidedBy},{' '}
              {when(decision.dateDecided)})
            </p>
          ))}
        </div>
      )}

      {saved && (
        <InlineNotification
          className={styles.notice}
          kind="success"
          lowContrast
          onClose={() => setSaved(false)}
          title={t('decisionRecorded', 'Decision recorded')}
          subtitle={t('decisionRecordedBody', 'It is applied in the next window. A later decision replaces this one until then.')}
        />
      )}
      {saveError && (
        <InlineNotification className={styles.notice} kind="error" lowContrast hideCloseButton title={saveError} />
      )}

      <RadioButtonGroup
        legendText={t('whichIsRight', 'Which version is right?')}
        name={`decision-${detail.id}`}
        orientation="vertical"
        valueSelected={choice}
        onChange={(value) => setChoice(value as DecisionChoice)}
      >
        <RadioButton
          id={`facility-stands-${detail.id}`}
          value="FACILITY_STANDS"
          labelText={t('facilityStandsLong', "The facility's version is right. Central's change is replaced.")}
        />
        <RadioButton
          id={`central-redone-${detail.id}`}
          value="CENTRAL_REDONE_AT_FACILITY"
          labelText={t(
            'centralRedoneLong',
            "Central's change is right. The facility will make the same change, and until it does the facility's version is shown here.",
          )}
        />
      </RadioButtonGroup>
      <TextArea
        id={`reason-${detail.id}`}
        className={styles.reason}
        labelText={t('reasonLabel', 'Reason')}
        helperText={t('reasonHelper', "Who you agreed this with and why. Do not write a patient's name or identifier.")}
        maxCount={reasonMaxLength}
        enableCounter
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button kind="primary" size="sm" disabled={!choice || !reason.trim() || saving} onClick={submit}>
        {saving ? t('recording', 'Recording...') : t('recordDecision', 'Record decision')}
      </Button>
    </section>
  );
};

export default SyncConflicts;
