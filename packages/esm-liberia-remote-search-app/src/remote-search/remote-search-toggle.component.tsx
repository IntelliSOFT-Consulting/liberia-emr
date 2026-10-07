import React from 'react';
import { Toggle } from '@carbon/react';
import { useConfig } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { useRemoteSearchAvailability, useRemoteSearchToggle } from './remote-search.context';
import { readSlotProps } from './slot-props';
import { useRemoteSearchMessages } from './use-messages';
import styles from './remote-search-toggle.scss';

interface RemoteSearchToggleProps {
  inDialog?: boolean;
  state?: { inDialog?: boolean };
}

/** The Remote Search card in the Refine Search sidebar, and in the tablet refine dialog (`inDialog`). */
const RemoteSearchToggle: React.FC<RemoteSearchToggleProps> = (props) => {
  const { t } = useTranslation();
  const message = useRemoteSearchMessages();
  const { inDialog } = readSlotProps<{ inDialog?: boolean }>(props);
  const config = useConfig();
  const { isAvailable, isOffline } = useRemoteSearchAvailability();
  const { isRemoteSearchEnabled, toggleRemoteSearch } = useRemoteSearchToggle();

  if (!isAvailable) {
    return null;
  }

  const label = config?.remoteSearchLabel ?? t('remoteSearch', 'Remote Search');
  const toggleLabel = t('toggleRemoteSearch', 'Toggle {{label}}', { label });

  return (
    <div className={inDialog ? styles.toggleCardInDialog : styles.toggleCard}>
      <div className={styles.toggleHeaderRow}>
        <span className={styles.toggleTitle}>{label}</span>
        {!isOffline && (
          <Toggle
            id="liberia-remote-search-toggle"
            toggled={isRemoteSearchEnabled}
            onToggle={toggleRemoteSearch}
            hideLabel
            size="sm"
            labelText={toggleLabel}
            aria-label={toggleLabel}
          />
        )}
      </div>
      <p className={styles.toggleHint}>
        {isOffline
          ? message(
              'offlineMessage',
              'remoteSearchOffline',
              'Remote Search is unavailable offline. This facility cannot reach central.',
            )
          : (config?.emptyStateHint ??
            t('remoteSearchHint', "Can't find the patient you're looking for? Try Remote Search"))}
      </p>
    </div>
  );
};

export default RemoteSearchToggle;
