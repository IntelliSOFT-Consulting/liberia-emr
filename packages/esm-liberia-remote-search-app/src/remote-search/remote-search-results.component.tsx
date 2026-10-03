import React, { useEffect, useMemo, useState } from 'react';
import { Button, InlineNotification, SkeletonPlaceholder, SkeletonText, Toggle } from '@carbon/react';
import {
  formatPartialDate,
  getPatientName,
  navigate,
  PatientBannerPatientInfo,
  PatientBannerToggleContactDetailsButton,
  PatientPhoto,
  showSnackbar,
  useConfig,
} from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import {
  fetchFhirPatient,
  type FhirPatient,
  importRemotePatient,
  minimumQueryLength,
  useRemotePatientSearch,
  type RemoteSearchedPatient,
} from './import-patient.resource';
import {
  resetRemoteSearchToggle,
  setRemoteCount,
  useRemoteSearchAvailability,
  useRemoteSearchToggle,
} from './remote-search.context';
import { readSlotProps } from './slot-props';
import { toFhirPatient } from './to-fhir-patient';
import { useRemoteSearchMessages } from './use-messages';
import styles from './remote-search-results.scss';

/**
 * What the patient-search patch hands the slot. Only `query` is always present.
 *  - isFullPage: rendered on the /search page or in a workspace (below the local results),
 *    not in the header dropdown.
 *  - inTabletOrOverlay: the workspace/tablet layout, which has no Refine Search sidebar and so
 *    has to carry its own toggle.
 *  - onPatientSelected: set inside a workspace (e.g. Add patient to queue); called instead of
 *    opening the chart, so the workspace flow decides what happens next.
 *  - onPatientOpened: set in the header dropdown; closes it once the patient is opened.
 */
interface SlotState {
  query?: string;
  isFullPage?: boolean;
  inTabletOrOverlay?: boolean;
  onPatientSelected?: (patientUuid: string, patient: FhirPatient) => void;
  onPatientOpened?: (patientUuid: string) => void;
}

type RemoteSearchResultsProps = SlotState & { state?: SlotState };

interface RemotePatientCardProps {
  patient: RemoteSearchedPatient;
  onImport: (uuid: string) => void;
  isImporting: boolean;
  buttonLabel?: string;
  variant: 'row' | 'card';
}

const RemotePatientCard: React.FC<RemotePatientCardProps> = ({
  patient,
  onImport,
  isImporting,
  buttonLabel,
  variant,
}) => {
  const { t } = useTranslation();
  const [showMore, setShowMore] = useState(false);
  const fhirPatient = useMemo(() => toFhirPatient(patient), [patient]);
  const patientName = getPatientName(fhirPatient);

  const importButton = (
    <Button kind="primary" size="md" onClick={() => onImport(patient.uuid)} disabled={isImporting}>
      {isImporting ? t('importing', 'Importing...') : (buttonLabel ?? t('importAndOpen', 'Import & Open'))}
    </Button>
  );

  const banner = (
    <div className={styles.patientBanner}>
      <div className={styles.patientAvatar}>
        <PatientPhoto patientUuid={patient.uuid} patientName={patientName} />
      </div>
      <PatientBannerPatientInfo patient={fhirPatient as never} renderedFrom="remote-search" />
    </div>
  );

  // Header dropdown: one line per patient, the button at the right, like a local result row.
  if (variant === 'row') {
    return (
      <div className={styles.rowContainer} role="banner">
        {banner}
        <div className={styles.rowAction}>{importButton}</div>
      </div>
    );
  }

  return (
    <div className={styles.container} role="banner">
      {banner}
      <div className={styles.actionButtons}>
        <PatientBannerToggleContactDetailsButton
          showContactDetails={showMore}
          toggleContactDetails={() => setShowMore((open) => !open)}
        />
        <div className={styles.rightActions}>{importButton}</div>
      </div>
      {showMore && (
        <dl className={styles.moreDetails}>
          {(patient.identifiers ?? []).map((id, index) => (
            <div key={`${id.identifier}-${index}`}>
              <dt>{id.identifierType?.name ?? t('identifier', 'Identifier')}</dt>
              <dd>{id.identifier}</dd>
            </div>
          ))}
          {patient.person?.birthdate && (
            <div>
              <dt>{t('dateOfBirth', 'Date of birth')}</dt>
              <dd>
                {formatPartialDate(patient.person.birthdate, { time: false })}
                {patient.person.birthdateEstimated ? ` (${t('estimated', 'estimated')})` : ''}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
};

const ResultsSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className={styles.skeletonList} role="progressbar" aria-busy="true" aria-label={label}>
    {[0, 1].map((row) => (
      <div key={row} className={styles.skeletonRow}>
        <SkeletonPlaceholder className={styles.skeletonAvatar} />
        <div className={styles.skeletonText}>
          <SkeletonText heading width="45%" />
          <SkeletonText width="70%" />
        </div>
      </div>
    ))}
  </div>
);

const RemoteSearchResults: React.FC<RemoteSearchResultsProps> = (props) => {
  const { t } = useTranslation();
  const message = useRemoteSearchMessages();
  const config = useConfig();
  const { isAvailable, isOffline } = useRemoteSearchAvailability();
  const { isRemoteSearchEnabled, toggleRemoteSearch } = useRemoteSearchToggle();
  const [importingUuids, setImportingUuids] = useState<Set<string>>(new Set());

  const slot = readSlotProps<SlotState>(props);
  const query = slot.query ?? '';
  const isFullPage = Boolean(slot.isFullPage);
  const inTabletOrOverlay = Boolean(slot.inTabletOrOverlay);
  const onPatientSelected = slot.onPatientSelected;
  const onPatientOpened = slot.onPatientOpened;
  const minLength = Math.max(2, Number(config?.minimumQueryLength) || minimumQueryLength);

  // The full desktop page keeps its toggle in the Refine Search sidebar; the dropdown and the
  // workspace have no sidebar, so they carry the toggle in their own section header.
  const hasSidebarToggle = isFullPage && !inTabletOrOverlay;
  const searchActive = isAvailable && !isOffline && isRemoteSearchEnabled;

  const { results, alreadyLocalCount, isLoading, error, hasSearched } = useRemotePatientSearch(
    query,
    searchActive,
    minLength,
  );

  // Each new search starts with Remote Search off (or the configured default): the user turns it
  // on when they need it. The slot mounts with the search and unmounts when it is closed.
  const resetOnClose = config?.resetToggleOnClose !== false;
  useEffect(() => {
    return () => {
      if (resetOnClose) resetRemoteSearchToggle();
    };
  }, [resetOnClose]);

  // The summary heading on the full page ("5 results ... 3 local · 2 from remote search") reads
  // this count from the store.
  const reportCount = hasSidebarToggle && hasSearched ? results.length : null;
  useEffect(() => {
    if (!hasSidebarToggle) return;
    setRemoteCount(reportCount);
    return () => setRemoteCount(null);
  }, [hasSidebarToggle, reportCount]);

  if (!isAvailable) {
    return null;
  }

  const label = config?.remoteSearchLabel ?? t('remoteSearch', 'Remote Search');
  const toggleLabel = t('toggleRemoteSearch', 'Toggle {{label}}', { label });

  if (isOffline) {
    if (hasSidebarToggle) return null; // the sidebar card explains it
    return (
      <div className={styles.toggleOffFooter}>
        <span className={styles.toggleOffHint}>
          {message('offlineMessage', 'remoteSearchOffline', 'Remote Search is unavailable while offline')}
        </span>
      </div>
    );
  }

  const handleImport = async (remoteUuid: string) => {
    setImportingUuids((prev) => new Set(prev).add(remoteUuid));
    try {
      const { localUuid } = await importRemotePatient(remoteUuid);

      showSnackbar({
        isLowContrast: true,
        title: message('importSuccessMessage', 'importSuccess', 'Patient imported successfully'),
        kind: 'success',
      });

      if (onPatientSelected) {
        // Inside a workspace the flow (add to queue, book appointment...) takes over.
        onPatientSelected(localUuid, await fetchFhirPatient(localUuid));
      } else {
        onPatientOpened?.(localUuid);
        navigate({ to: `\${openmrsSpaBase}/patient/${localUuid}/chart` });
      }
    } catch (err: any) {
      showSnackbar({
        isLowContrast: true,
        title: t('importError', 'Failed to import patient'),
        subtitle: err?.responseBody?.error ?? err?.message ?? String(err),
        kind: 'error',
      });
    } finally {
      // Also on success: a workspace stays mounted, and the button must not stay stuck.
      setImportingUuids((prev) => {
        const next = new Set(prev);
        next.delete(remoteUuid);
        return next;
      });
    }
  };

  // Off state on the dropdown/workspace: just the hint and the toggle. The sidebar card is the toggle there.
  if (!isRemoteSearchEnabled && hasSidebarToggle) return null;

  const heading = hasSearched
    ? t('remoteSearchHeading', '{{label}} · {{count}} MATCHES', {
        label: label.toUpperCase(),
        count: results.length,
        defaultValue_one: '{{label}} · {{count}} MATCH',
      })
    : label.toUpperCase();

  return (
    <section className={styles.resultsContainer} aria-label={label}>
      <div className={styles.remoteHeaderRow}>
        {isRemoteSearchEnabled ? (
          <h3 className={styles.sectionHeader}>{heading}</h3>
        ) : (
          <span className={styles.toggleOffHint}>
            {config?.emptyStateHint ??
              t('remoteSearchHint', "Can't find the patient you're looking for? Try Remote Search")}
          </span>
        )}
        {!hasSidebarToggle && (
          // One Toggle for both states, so flipping it keeps the same element (and focus) instead of remounting.
          <Toggle
            id="liberia-remote-search-inline-toggle"
            toggled={isRemoteSearchEnabled}
            onToggle={toggleRemoteSearch}
            hideLabel
            size="sm"
            labelText={toggleLabel}
            aria-label={toggleLabel}
          />
        )}
      </div>

      {isRemoteSearchEnabled && (
        <div aria-live="polite">
          {isLoading && (
            <>
              <p className={styles.loadingCaption}>
                {message('searchingMessage', 'searchingRemote', 'Searching the central server...')}
              </p>
              <ResultsSkeleton
                label={message('searchingMessage', 'searchingRemote', 'Searching the central server...')}
              />
            </>
          )}

          {error && !isLoading && (
            <div className={styles.notificationWrapper}>
              <InlineNotification
                kind="warning"
                lowContrast
                hideCloseButton
                title={message('unavailableTitle', 'remoteSearchUnavailable', 'Remote Search is unavailable')}
                subtitle={message(
                  'unavailableMessage',
                  'remoteSearchUnavailableDetail',
                  'The central server could not be reached. Try again shortly.',
                )}
              />
            </div>
          )}

          {!isLoading && !error && results.length === 0 && (
            <div className={styles.emptyState}>
              {query.trim().length < minLength
                ? message(
                    'minCharactersMessage',
                    'enterMinCharacters',
                    'Enter at least {{count}} characters to search the central server.',
                    { count: minLength },
                  )
                : alreadyLocalCount > 0
                  ? message(
                      'alreadyLocalMessage',
                      'alreadyAtFacility',
                      '{{count}} matching patient(s) on the central server are already at this facility. See the local results.',
                      { count: alreadyLocalCount, query: query.trim() },
                    )
                  : message(
                      'noResultsMessage',
                      'noRemoteResults',
                      'No patients on the central server match "{{query}}".',
                      { query: query.trim() },
                    )}
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <div
              className={
                hasSidebarToggle ? styles.cardsList : inTabletOrOverlay ? styles.cardsListScrollable : styles.rowsList
              }
            >
              {results.map((patient) => (
                <RemotePatientCard
                  key={patient.uuid}
                  patient={patient}
                  variant={isFullPage ? 'card' : 'row'}
                  onImport={handleImport}
                  isImporting={importingUuids.has(patient.uuid)}
                  buttonLabel={config?.importButtonLabel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default RemoteSearchResults;
