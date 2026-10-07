import { createGlobalStore, getConfig, useConfig, useSession, userHasAccess, useStore } from '@openmrs/esm-framework';
import { useCallback, useEffect, useState } from 'react';
import { useRemoteSearchStatus } from './import-patient.resource';

const moduleName = '@liberiaemr/esm-liberia-remote-search-app';
const storageKey = 'liberiaemr:remoteSearchEnabled';

interface RemoteSearchState {
  isRemoteSearchEnabled: boolean;
  /** Matches the full-page results list currently shows; null until a search has finished. */
  remoteCount: number | null;
}

// Global store so the toggle, the results and the summary extensions (separate React roots)
// share one source of truth.
export const remoteSearchStore = createGlobalStore<RemoteSearchState>('liberiaRemoteSearch', {
  isRemoteSearchEnabled: false,
  remoteCount: null,
});

let rememberToggleState = false;
let defaultToggleOn = false;
let initialised: Promise<void> | undefined;
// Set once the user flips the toggle, so a slow config response cannot overwrite their choice.
let userHasToggled = false;

function readStoredToggle(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function storeToggle(value: boolean) {
  try {
    localStorage.setItem(storageKey, String(value));
  } catch {
    // Storage can be blocked (private mode); the toggle still works for this page load.
  }
}

/**
 * Reads the configured default and the remembered position once per page load. Doing this in a
 * per-component effect re-applied the default every time a component mounted, which undid a
 * toggle the user had just flipped whenever the search dropdown reopened.
 */
function initialiseStore(): Promise<void> {
  if (!initialised) {
    initialised = getConfig(moduleName)
      .then((config) => {
        rememberToggleState = config?.rememberToggleState ?? false;
        defaultToggleOn = config?.defaultToggleOn ?? false;
        let initialValue = defaultToggleOn;
        if (rememberToggleState) {
          const stored = readStoredToggle();
          if (stored !== null) {
            initialValue = stored === 'true';
          }
        }
        if (!userHasToggled) {
          remoteSearchStore.setState({ isRemoteSearchEnabled: initialValue });
        }
      })
      .catch(() => undefined);
  }
  return initialised;
}

export function useRemoteSearchToggle() {
  const state = useStore(remoteSearchStore);

  useEffect(() => {
    initialiseStore();
  }, []);

  const toggleRemoteSearch = useCallback(() => {
    userHasToggled = true;
    const newValue = !remoteSearchStore.getState().isRemoteSearchEnabled;
    remoteSearchStore.setState({ isRemoteSearchEnabled: newValue });
    if (rememberToggleState) {
      storeToggle(newValue);
    }
  }, []);

  return {
    isRemoteSearchEnabled: state.isRemoteSearchEnabled,
    remoteCount: state.remoteCount,
    toggleRemoteSearch,
  };
}

/** Puts the toggle back to its configured default, e.g. when a search is closed. Not remembered. */
export function resetRemoteSearchToggle() {
  userHasToggled = false;
  remoteSearchStore.setState({ isRemoteSearchEnabled: defaultToggleOn, remoteCount: null });
}

export function setRemoteCount(remoteCount: number | null) {
  remoteSearchStore.setState({ remoteCount });
}

function useIsOffline() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return offline;
}

/**
 * Whether the remote search UI should appear at all: on in this app's config, configured on the
 * server (a facility with no central URL has nothing to search), and permitted for this user.
 * While the server has not answered yet it stays hidden rather than flashing in and out.
 */
export function useRemoteSearchAvailability() {
  const config = useConfig();
  const { status } = useRemoteSearchStatus();
  const isOffline = useIsOffline();

  return {
    isAvailable: config?.enabled !== false && status?.enabled === true,
    isOffline,
  };
}

/**
 * The server's import endpoint needs both: Add Patients, and Import Remote Patient on top of it
 * (LE-384). A user without them sees a hint instead of the Import & Open button.
 */
export const importPrivileges = ['Add Patients', 'Import Remote Patient'];

export function useCanImportRemotePatient() {
  const session = useSession();
  return Boolean(session?.user && userHasAccess(importPrivileges, session.user));
}
