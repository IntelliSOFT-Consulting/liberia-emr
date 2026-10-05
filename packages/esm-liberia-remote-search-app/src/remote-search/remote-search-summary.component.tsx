import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRemoteSearchToggle } from './remote-search.context';
import { readSlotProps } from './slot-props';
import styles from './remote-search-results.scss';

interface SummaryState {
  query?: string;
  localCount?: number;
  isLoading?: boolean;
  inTabletOrOverlay?: boolean;
}

type RemoteSearchSummaryProps = SummaryState & { state?: SummaryState };

/**
 * The heading above the full search page's result sections: `5 results for "Kollie"`, and when
 * Remote Search is on, `3 local · 2 from remote search`. The patch places it above the local
 * section, whose own heading it leaves alone.
 */
const RemoteSearchSummary: React.FC<RemoteSearchSummaryProps> = (props) => {
  const state = readSlotProps<SummaryState>(props);
  const { t } = useTranslation();
  const { isRemoteSearchEnabled, remoteCount } = useRemoteSearchToggle();

  const query = state.query?.trim() ?? '';
  const localCount = state.localCount ?? 0;

  // No summary in the workspace layout, and none while the local search is still running
  // (its count is 0 until it answers).
  if (!query || state.inTabletOrOverlay || state.isLoading) {
    return null;
  }

  const showRemote = isRemoteSearchEnabled && remoteCount !== null;
  const total = localCount + (showRemote ? remoteCount : 0);

  return (
    <div className={styles.summary}>
      <h2 className={styles.summaryHeading}>
        {t('resultsFor', '{{count}} results for "{{query}}"', {
          count: total,
          query,
          defaultValue_one: '{{count}} result for "{{query}}"',
        })}
      </h2>
      {showRemote && (
        <p className={styles.summarySubheading}>
          {t('localAndRemoteCounts', '{{local}} local · {{remote}} from remote search', {
            local: localCount,
            remote: remoteCount,
          })}
        </p>
      )}
    </div>
  );
};

export default RemoteSearchSummary;
