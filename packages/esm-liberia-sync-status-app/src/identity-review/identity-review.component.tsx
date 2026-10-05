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
  Tile,
} from '@carbon/react';
import { formatDate } from '@openmrs/esm-framework';
import {
  type ReviewDecisionChoice,
  type ReviewDetail,
  type ReviewRecord,
  type ReviewSummary,
  recordReviewDecision,
  useIdentityReviews,
  useReviewDetail,
} from './identity-review.resource';
// The same look as the sync conflicts page, which works the same way: a list, one item under
// review, and a decision with a reason.
import styles from '../sync-conflicts/sync-conflicts.scss';

const reasonMaxLength = 500;

function when(millis: number | null | undefined) {
  return millis ? formatDate(new Date(millis)) : '';
}

/**
 * The identity review queue at central (ADR 0005, band 2): pairs of records the matcher could not
 * decide by itself. A person compares them and says whether they are one person; the server then
 * links them, separates them, or leaves them as they are. Nothing is ever merged or deleted.
 */
const IdentityReview: React.FC = () => {
  const { t } = useTranslation();
  const { reviews, error, isLoading, mutate } = useIdentityReviews();
  const [selected, setSelected] = useState<ReviewSummary | null>(null);
  const [decided, setDecided] = useState<ReviewDetail | null>(null);

  if (isLoading) {
    return <InlineLoading className={styles.container} description={t('loadingReviews', 'Loading possible matches...')} />;
  }

  if (error?.response?.status === 403) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('reviewsNotPermitted', 'You do not have permission to review possible matches')}
          subtitle={t('askForReviewPrivilege', 'Ask ICT for the Review Identity Matches privilege.')}
        />
      </div>
    );
  }

  if (error || !reviews?.enabled) {
    return (
      <div className={styles.container}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={t('reviewsNotAvailableHere', 'Identity review is not available on this server')}
          subtitle={t('reviewsCentralOnly', 'Possible matches are reviewed at central, where records from every facility meet.')}
        />
      </div>
    );
  }

  const open = reviews.reviews ?? [];
  const recent = reviews.recent ?? [];

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('identityReview', 'Possible matches')}</h3>
      <p className={styles.explainer}>
        {t(
          'identityReviewExplainer',
          'Records from different facilities that may be the same person, which the matcher could not decide by itself. Compare the two records and say whether they are the same person. Records are linked, never merged: a decision can be reversed by a later review.',
        )}
      </p>

      {decided && (
        <InlineNotification
          className={styles.notice}
          kind="success"
          lowContrast
          onClose={() => setDecided(null)}
          title={t('reviewDecided', 'Decision recorded')}
          subtitle={
            decided.linked
              ? t('nowLinked', 'The two records are now linked to one person.')
              : t('nowApart', 'The two records are kept as different people.')
          }
        />
      )}

      <TableContainer
        title={t('waitingForReview', 'Waiting for a decision')}
        description={
          reviews.total > open.length
            ? t('oldestShown', 'The oldest {{shown}} of {{total}}.', { shown: open.length, total: reviews.total })
            : undefined
        }
      >
        <Table size="sm" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader>{t('raised', 'Raised')}</TableHeader>
              <TableHeader>{t('facilities', 'Facilities')}</TableHeader>
              <TableHeader>{t('whyFlagged', 'Why it needs a person')}</TableHeader>
              <TableHeader>{t('linkedNow', 'Linked now')}</TableHeader>
              <TableHeader />
            </TableRow>
          </TableHead>
          <TableBody>
            {open.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{t('noReviews', 'No possible matches are waiting.')}</TableCell>
              </TableRow>
            ) : (
              open.map((review) => (
                <TableRow key={review.id} className={selected?.id === review.id ? styles.selectedRow : undefined}>
                  <TableCell>{when(review.raised)}</TableCell>
                  <TableCell>{review.facilities.map((facility) => facility ?? t('unknownFacility', 'Unknown')).join(' / ')}</TableCell>
                  <TableCell>{review.reason}</TableCell>
                  <TableCell>
                    {review.linked ? <Tag type="blue">{t('yes', 'Yes')}</Tag> : <Tag type="gray">{t('no', 'No')}</Tag>}
                  </TableCell>
                  <TableCell>
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        setDecided(null);
                        setSelected(review);
                      }}
                    >
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
        <PairReview
          key={selected.id}
          id={selected.id}
          onDecided={async (detail) => {
            setSelected(null);
            setDecided(detail);
            await mutate();
          }}
          onClose={() => setSelected(null)}
        />
      )}

      {recent.length > 0 && (
        <TableContainer className={styles.section} title={t('decidedRecently', 'Decided in the last 30 days')}>
          <Table size="sm" useZebraStyles>
            <TableHead>
              <TableRow>
                <TableHeader>{t('decision', 'Decision')}</TableHeader>
                <TableHeader>{t('reason', 'Reason')}</TableHeader>
                <TableHeader>{t('decidedBy', 'Decided by')}</TableHeader>
                <TableHeader>{t('decidedOn', 'Decided')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <DecisionLabel decision={entry.decision} />
                  </TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell>{entry.decidedBy}</TableCell>
                  <TableCell>{when(entry.dateDecided)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
};

const DecisionLabel: React.FC<{ decision: ReviewDecisionChoice }> = ({ decision }) => {
  const { t } = useTranslation();
  return decision === 'SAME_PERSON' ? (
    <Tag type="blue">{t('samePerson', 'Same person')}</Tag>
  ) : (
    <Tag type="gray">{t('differentPeople', 'Different people')}</Tag>
  );
};

interface PairReviewProps {
  id: number;
  onDecided: (detail: ReviewDetail) => void;
  onClose: () => void;
}

/** Both records side by side, with the facts the matcher compared marked where they differ. */
const PairReview: React.FC<PairReviewProps> = ({ id, onDecided, onClose }) => {
  const { t } = useTranslation();
  const { detail, error, isLoading } = useReviewDetail(id);

  if (isLoading) {
    return <InlineLoading description={t('loadingPair', 'Loading the two records...')} />;
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
            ? t('reviewGone', 'This review no longer exists')
            : t('reviewUnreadable', 'This review cannot be read')
        }
      />
    );
  }

  const [under, other] = detail.records;
  const rows: Array<{ label: string; a: string; b: string; compared: boolean }> = [
    { label: t('name', 'Name'), a: under.name ?? '', b: other.name ?? '', compared: true },
    { label: t('sex', 'Sex'), a: under.sex ?? '', b: other.sex ?? '', compared: true },
    {
      label: t('dateOfBirth', 'Date of birth'),
      a: birth(under, t('estimated', 'estimated')),
      b: birth(other, t('estimated', 'estimated')),
      compared: true,
    },
    { label: t('nationalId', 'National ID'), a: under.nationalId ?? '', b: other.nationalId ?? '', compared: true },
    {
      label: t('identifiers', 'Identifiers'),
      a: (under.identifiers ?? []).map((id) => `${id.type}: ${id.identifier}`).join(', '),
      b: (other.identifiers ?? []).map((id) => `${id.type}: ${id.identifier}`).join(', '),
      compared: false,
    },
    { label: t('facility', 'Facility'), a: under.facility ?? '', b: other.facility ?? '', compared: false },
    { label: t('registered', 'Registered'), a: when(under.registered), b: when(other.registered), compared: false },
    {
      label: t('alsoLinked', 'Other records linked to this person'),
      a: String(under.otherRecordsLinked ?? 0),
      b: String(other.otherRecordsLinked ?? 0),
      compared: false,
    },
  ];

  return (
    <Tile className={styles.review}>
      <section aria-label={t('reviewPair', 'Review possible match')}>
        <div className={styles.reviewHeader}>
          <div>
            <h4 className={styles.subheading}>{detail.reason}</h4>
            <p className={styles.meta}>
              {t('raisedOn', 'Raised {{raised}}.', { raised: when(detail.raised) })}{' '}
              {detail.linked
                ? t('linkedExplainer', 'These records are linked to one person now.')
                : t('apartExplainer', 'These records are not linked.')}
            </p>
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t('close', 'Close')}
          </Button>
        </div>

        {(under.voided || other.voided || under.missing || other.missing) && (
          <InlineNotification
            className={styles.notice}
            kind="warning"
            lowContrast
            hideCloseButton
            title={t('recordVoided', 'One of these records was voided or removed at its facility')}
            subtitle={t('recordVoidedBody', 'Check with the facility before deciding.')}
          />
        )}

        <Table size="sm" className={styles.comparison}>
          <TableHead>
            <TableRow>
              <TableHeader />
              <TableHeader>{t('recordUnderReview', 'Record under review')}</TableHeader>
              <TableHeader>{t('matchedRecord', 'Record it matched')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.label}
                className={row.compared && row.a.toLowerCase() !== row.b.toLowerCase() ? styles.differs : undefined}
              >
                <TableCell>{row.label}</TableCell>
                <TableCell>{row.a || '—'}</TableCell>
                <TableCell>{row.b || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {detail.status === 'OPEN' ? (
          <DecisionForm detail={detail} onRecorded={onDecided} />
        ) : (
          detail.decision && (
            <p className={styles.meta}>
              <DecisionLabel decision={detail.decision.decision} />: {detail.decision.reason} ({detail.decision.decidedBy},{' '}
              {when(detail.decision.dateDecided)})
            </p>
          )
        )}
      </section>
    </Tile>
  );
};

function birth(record: ReviewRecord, estimated: string) {
  if (!record.birthdate) {
    return '';
  }
  return record.birthdateEstimated ? `${record.birthdate} (${estimated})` : record.birthdate;
}

interface DecisionFormProps {
  detail: ReviewDetail;
  onRecorded: (detail: ReviewDetail) => void;
}

const DecisionForm: React.FC<DecisionFormProps> = ({ detail, onRecorded }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ReviewDecisionChoice | ''>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const underFacility = detail.records[0].facility ?? t('itsFacility', 'its facility');

  // Says what the server will do, since the same answer acts differently on linked records.
  let effect: string | null = null;
  if (choice === 'SAME_PERSON') {
    effect = detail.linked
      ? t('effectKeep', 'They stay linked. Nothing changes.')
      : t('effectLink', 'The two records are linked to one person. Neither record is changed.');
  } else if (choice === 'DIFFERENT_PEOPLE') {
    effect = detail.linked
      ? t(
          'effectSeparate',
          'The record from {{facility}} is separated from this person. Any other records linked to the person stay linked.',
          { facility: underFacility },
        )
      : t('effectApart', 'They stay apart, and are not offered for review again.');
  }

  const submit = async () => {
    if (!choice || !reason.trim()) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await recordReviewDecision(detail.id, choice, reason.trim());
      onRecorded(response.data);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setSaveError(
        status === 404 || status === 409
          ? t('reviewStale', 'Someone else decided this review while you were looking at it. Reload the page.')
          : t('reviewFailed', 'The decision was not recorded. Try again.'),
      );
      setSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <h5 className={styles.label}>{t('recordADecision', 'Record a decision')}</h5>
      {saveError && <InlineNotification className={styles.notice} kind="error" lowContrast hideCloseButton title={saveError} />}
      <RadioButtonGroup
        legendText={t('isSamePerson', 'Are these the same person?')}
        name={`identity-decision-${detail.id}`}
        orientation="vertical"
        valueSelected={choice}
        onChange={(value) => setChoice(value as ReviewDecisionChoice)}
      >
        <RadioButton id={`same-${detail.id}`} value="SAME_PERSON" labelText={t('samePersonLong', 'Yes, the same person')} />
        <RadioButton
          id={`different-${detail.id}`}
          value="DIFFERENT_PEOPLE"
          labelText={t('differentPeopleLong', 'No, different people')}
        />
      </RadioButtonGroup>
      {effect && <p className={styles.meta}>{effect}</p>}
      <TextArea
        id={`identity-reason-${detail.id}`}
        className={styles.reason}
        rows={3}
        labelText={t('reasonLabel', 'Reason')}
        helperText={t(
          'identityReasonHelper',
          "What you checked and with whom, for example the facility's records officer. Do not write the patient's name or identifiers.",
        )}
        maxCount={reasonMaxLength}
        enableCounter
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        <Button kind="primary" size="sm" disabled={!choice || !reason.trim() || saving} onClick={submit}>
          {saving ? t('recording', 'Recording...') : t('recordDecision', 'Record decision')}
        </Button>
      </div>
    </div>
  );
};

export default IdentityReview;
