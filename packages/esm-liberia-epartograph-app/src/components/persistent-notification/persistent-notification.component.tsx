import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionableNotification, InlineNotification } from '@carbon/react';
import styles from './persistent-notification.scss';

export interface PersistentNotificationProps {
  /** Visual type matching Carbon ('error' | 'warning' | 'info' | 'success') */
  kind: 'error' | 'warning' | 'info' | 'success';
  /** Primary title of the notification */
  title: string;
  /** Explanatory message or subtitle (optional) */
  subtitle?: React.ReactNode;
  /** Action button text (optional: if omitted, notification renders as text-only) */
  actionButtonLabel?: string;
  /** Callback when the action button is clicked (optional) */
  onActionButtonClick?: () => void;
  /** Callback when dismissed (optional) */
  onClose?: () => void;
  /** Whether to hide the close ('x') button (default: false) */
  hideCloseButton?: boolean;
  /** Controlled visibility */
  isOpen?: boolean;
  /** Low contrast styling (default: true) */
  lowContrast?: boolean;
  /** Key to automatically reset dismissal when alert status or message changes */
  notificationKey?: string | number;
  /** Additional custom class */
  className?: string;
  /** Optional custom body content */
  children?: React.ReactNode;
}

/**
 * PersistentNotification
 *
 * A generic, reusable notification component that anchors to the OpenMRS snackbar
 * position (bottom-left of the viewport) via React Portal, but remains visible
 * until dismissed or acted upon.
 *
 * Can be used in two modes:
 *  1. Actionable mode: Provide both `actionButtonLabel` and `onActionButtonClick`.
 *  2. Text-only mode: Omit `actionButtonLabel` and `onActionButtonClick`.
 */
export const PersistentNotification: React.FC<PersistentNotificationProps> = ({
  kind,
  title,
  subtitle,
  actionButtonLabel,
  onActionButtonClick,
  onClose,
  hideCloseButton = false,
  isOpen,
  lowContrast = true,
  notificationKey,
  className,
  children,
}) => {
  const [internalDismissedKey, setInternalDismissedKey] = useState<string | number | null>(null);

  // When notificationKey changes (e.g. status changes from 'normal' to 'due'), reset dismissal
  useEffect(() => {
    setInternalDismissedKey(null);
  }, [notificationKey]);

  const handleClose = useCallback(() => {
    if (notificationKey !== undefined) {
      setInternalDismissedKey(notificationKey);
    } else {
      setInternalDismissedKey('dismissed');
    }
    onClose?.();
  }, [notificationKey, onClose]);

  // Controlled mode check
  if (isOpen === false) {
    return null;
  }

  // Uncontrolled mode dismissal check
  const isDismissed =
    notificationKey !== undefined
      ? internalDismissedKey === notificationKey
      : internalDismissedKey === 'dismissed';

  if (isOpen === undefined && isDismissed) {
    return null;
  }

  // Render actionable button if both label and handler are provided; otherwise render clean text-only
  const hasAction = Boolean(actionButtonLabel && onActionButtonClick);

  const notificationContent = hasAction ? (
    <ActionableNotification
      kind={kind}
      title={title}
      subtitle={subtitle as any}
      actionButtonLabel={actionButtonLabel!}
      onActionButtonClick={onActionButtonClick!}
      onClose={handleClose}
      lowContrast={lowContrast}
      hideCloseButton={hideCloseButton}
    >
      {children}
    </ActionableNotification>
  ) : (
    <InlineNotification
      kind={kind}
      title={title}
      subtitle={subtitle as any}
      onClose={handleClose}
      lowContrast={lowContrast}
      hideCloseButton={hideCloseButton}
    >
      {children}
    </InlineNotification>
  );

  const container = (
    <aside className={`${styles.persistentNotificationContainer} ${className ?? ''}`}>
      {notificationContent}
    </aside>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(container, document.body);
  }

  return container;
};

export default PersistentNotification;
