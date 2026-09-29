import React from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Tag } from '@carbon/react';
import type { AuditAction, AuditEntry } from './audit-log.resource';

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = dayjs(value);
  return date.isValid() ? date.format('DD-MMM-YYYY HH:mm:ss') : value;
}

export function ActionTag({ action }: { action: AuditAction }) {
  const { t } = useTranslation();
  const labels: Record<AuditAction, string> = {
    CREATED: t('created', 'Created'),
    UPDATED: t('updated', 'Updated'),
    DELETED: t('deleted', 'Deleted'),
  };
  const colours: Record<AuditAction, 'green' | 'blue' | 'red'> = { CREATED: 'green', UPDATED: 'blue', DELETED: 'red' };
  return (
    <Tag type={colours[action] ?? 'gray'} size="sm">
      {labels[action] ?? action}
    </Tag>
  );
}

export function userLabel(entry: Pick<AuditEntry, 'user'>, systemLabel: string): string {
  if (!entry.user) {
    return systemLabel;
  }
  return entry.user.username || entry.user.systemId || entry.user.uuid;
}
