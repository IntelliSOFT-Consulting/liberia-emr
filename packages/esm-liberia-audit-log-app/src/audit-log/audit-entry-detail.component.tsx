import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
} from '@carbon/react';
import {
  type AuditChange,
  type AuditEntryDetail as Detail,
  type AuditProperty,
  type AuditValue,
  displayValue,
  statusOf,
  useAuditEntry,
} from './audit-log.resource';
import { ActionTag, formatDate, userLabel } from './audit-log.shared';
import styles from './audit-log.scss';

function Value({ value, redacted }: { value: AuditValue; redacted: boolean }) {
  const { t } = useTranslation();
  if (redacted) {
    return (
      <Tag type="gray" size="sm">
        {t('redacted', 'Redacted')}
      </Tag>
    );
  }
  const text = displayValue(value);
  return text ? <span className={styles.value}>{text}</span> : <span className={styles.helper}>{t('none', '(none)')}</span>;
}

function Changes({ changes }: { changes: Array<AuditChange> }) {
  const { t } = useTranslation();
  if (!changes.length) {
    return <p className={styles.helper}>{t('noChanges', 'No changed values were recorded.')}</p>;
  }
  return (
    <StructuredListWrapper isCondensed aria-label={t('changes', 'Changes')} data-testid="audit-changes">
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>{t('property', 'Property')}</StructuredListCell>
          <StructuredListCell head>{t('previous', 'Previous value')}</StructuredListCell>
          <StructuredListCell head>{t('current', 'New value')}</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {changes.map((change) => (
          <StructuredListRow key={change.property} data-testid="audit-change">
            <StructuredListCell>{change.property}</StructuredListCell>
            <StructuredListCell>
              <Value value={change.previous} redacted={change.redacted} />
            </StructuredListCell>
            <StructuredListCell>
              <Value value={change.current} redacted={change.redacted} />
            </StructuredListCell>
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

function LastState({ state }: { state: Array<AuditProperty> }) {
  const { t } = useTranslation();
  if (!state.length) {
    return (
      <p className={styles.helper}>
        {t('noLastState', 'The last state was not kept (auditlog.storeLastStateOfDeletedItems was off).')}
      </p>
    );
  }
  return (
    <StructuredListWrapper isCondensed aria-label={t('lastState', 'Last state before deletion')}>
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>{t('property', 'Property')}</StructuredListCell>
          <StructuredListCell head>{t('value', 'Value')}</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {state.map((property) => (
          <StructuredListRow key={property.property}>
            <StructuredListCell>{property.property}</StructuredListCell>
            <StructuredListCell>
              <Value value={property.value} redacted={property.redacted} />
            </StructuredListCell>
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

function Values({ entry }: { entry: Detail }) {
  const { t } = useTranslation();
  if (entry.action === 'UPDATED') {
    return <Changes changes={entry.changes ?? []} />;
  }
  if (entry.action === 'DELETED') {
    return (
      <>
        <h5 className={styles.subheading}>{t('lastState', 'Last state before deletion')}</h5>
        <LastState state={entry.lastState ?? []} />
      </>
    );
  }
  return <p className={styles.helper}>{t('createdNoValues', 'A creation records who and when, not the values.')}</p>;
}

interface Props {
  uuid: string;
  onClose: () => void;
  onOpen: (uuid: string) => void;
}

/** One audit log entry: who, when, what, and the values recorded, with the entries saved as part of it. */
const AuditEntryDetail: React.FC<Props> = ({ uuid, onClose, onOpen }) => {
  const { t } = useTranslation();
  const { entry, error, isLoading } = useAuditEntry(uuid);

  if (isLoading) {
    return <InlineLoading description={t('loading', 'Loading…')} />;
  }
  if (error || !entry) {
    return (
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title={
          statusOf(error) === 404
            ? t('entryNotFound', 'This entry is not available')
            : t('entryLoadFailed', 'The entry could not be loaded')
        }
      />
    );
  }

  const children = entry.children ?? [];
  return (
    <section className={styles.detail} aria-label={t('entryDetail', 'Entry detail')} data-testid="audit-detail">
      <div className={styles.detailHeader}>
        <h4 className={styles.subheading}>
          {entry.typeName} {entry.identifier}
        </h4>
        <Button kind="ghost" size="sm" onClick={onClose}>
          {t('close', 'Close')}
        </Button>
      </div>
      <dl className={styles.facts}>
        <dt>{t('action', 'Action')}</dt>
        <dd>
          <ActionTag action={entry.action} />
        </dd>
        <dt>{t('date', 'Date')}</dt>
        <dd>{formatDate(entry.dateCreated)}</dd>
        <dt>{t('user', 'User')}</dt>
        <dd>{userLabel(entry, t('system', 'System'))}</dd>
        <dt>{t('type', 'Type')}</dt>
        <dd className={styles.value}>{entry.type}</dd>
        <dt>{t('entryUuid', 'Entry UUID')}</dt>
        <dd className={styles.value}>{entry.uuid}</dd>
      </dl>
      {entry.parentUuid ? (
        <Button kind="ghost" size="sm" onClick={() => onOpen(entry.parentUuid)}>
          {t('openParent', 'Open the entry this was saved with')}
        </Button>
      ) : null}
      <Values entry={entry} />
      {children.length > 0 ? (
        <>
          <h5 className={styles.subheading}>
            {t('savedWith', 'Saved with it ({{count}})', { count: children.length })}
          </h5>
          {children.map((child) => (
            <div key={child.uuid} className={styles.child}>
              <div>
                <ActionTag action={child.action} /> {child.typeName} {child.identifier}
              </div>
              <Values entry={child} />
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
};

export default AuditEntryDetail;
