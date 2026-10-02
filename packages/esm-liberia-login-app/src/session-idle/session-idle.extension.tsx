import { useEffect, useRef } from 'react';
import { useConfig, useSession } from '@openmrs/esm-framework';
import { clearHistory } from '@openmrs/esm-framework/src/internal';
import { type ConfigSchema } from '../config-schema';
import { completeLogout, navigateAfterLogout } from '../redirect-logout/logout.resource';
import {
  HUMAN_ACTIVITY_STORAGE_KEY,
  clearHumanActivity,
  readHumanActivity,
  recordHumanActivity,
  resolveIdleTimeoutMinutes,
} from './idle-timeout';

/** Writes to localStorage at most this often. Mouse movement must not update React state. */
const ACTIVITY_THROTTLE_MS = 1000;

/**
 * How often an open tab compares the clock with the shared timestamp.
 * Background tabs may delay this; visibility and focus re-check immediately.
 */
const CHECK_INTERVAL_MS = 15000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/**
 * Invisible watcher mounted from `top-nav-info-slot`, which stays on screen for
 * authenticated O3 use. The login route does not.
 */
const SessionIdle: React.FC = () => {
  const config = useConfig<ConfigSchema>();
  const session = useSession();
  const loggingOut = useRef(false);
  const lastWriteAt = useRef(0);
  const timeoutMinutes = resolveIdleTimeoutMinutes(config?.session?.idleTimeoutMinutes);
  const providerType = config?.provider?.type;
  const loginUrl = config?.provider?.loginUrl;
  const authenticated = Boolean(session?.authenticated);

  useEffect(() => {
    if (!authenticated || !providerType) {
      return undefined;
    }

    const provider = { type: providerType, loginUrl };
    const timeoutMs = timeoutMinutes * 60 * 1000;

    const expire = (peerAlreadyLoggedOut: boolean) => {
      if (loggingOut.current) {
        return;
      }
      loggingOut.current = true;
      clearHistory();
      void completeLogout(provider)
        .then(() => {
          clearHumanActivity();
        })
        .catch((error: unknown) => {
          if (peerAlreadyLoggedOut) {
            console.error('Idle logout failed after another tab ended the session:', error);
            navigateAfterLogout(provider);
            return;
          }
          loggingOut.current = false;
          console.error('Idle logout failed:', error);
        });
    };

    const check = () => {
      if (loggingOut.current) {
        return;
      }
      const now = Date.now();
      const read = readHumanActivity(now);
      if (read.status === 'missing' || read.status === 'invalid') {
        expire(read.status === 'missing');
        return;
      }
      if (now - read.at >= timeoutMs) {
        expire(false);
      }
    };

    let exactTimer = 0;
    const scheduleExact = () => {
      window.clearTimeout(exactTimer);
      if (loggingOut.current) {
        return;
      }
      const read = readHumanActivity(Date.now());
      if (read.status !== 'ok') {
        return;
      }
      const remaining = timeoutMs - (Date.now() - read.at);
      exactTimer = window.setTimeout(check, Math.max(0, remaining));
    };

    const now = Date.now();
    const initial = readHumanActivity(now);
    if (initial.status === 'missing') {
      recordHumanActivity(now);
      lastWriteAt.current = now;
    } else if (initial.status === 'invalid' || now - initial.at >= timeoutMs) {
      expire(false);
    }
    scheduleExact();

    const onActivity = () => {
      if (loggingOut.current) {
        return;
      }
      const activityAt = Date.now();
      if (activityAt - lastWriteAt.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastWriteAt.current = activityAt;
      recordHumanActivity(activityAt);
      scheduleExact();
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      check();
      scheduleExact();
    };

    const onFocus = () => {
      check();
      scheduleExact();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== HUMAN_ACTIVITY_STORAGE_KEY) {
        return;
      }
      if (event.newValue == null) {
        expire(true);
        return;
      }
      check();
      scheduleExact();
    };

    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, listenerOptions);
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, listenerOptions);
      }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(interval);
      window.clearTimeout(exactTimer);
    };
  }, [authenticated, loginUrl, providerType, timeoutMinutes]);

  return null;
};

export default SessionIdle;
