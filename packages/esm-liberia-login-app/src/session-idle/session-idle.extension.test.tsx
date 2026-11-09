import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  type FetchResponse,
  type Session,
  clearCurrentUser,
  navigate,
  openmrsFetch,
  restBaseUrl,
  setUserLanguage,
  useConfig,
  useSession,
} from '@openmrs/esm-framework';
import routes from '../routes.json';
import { HUMAN_ACTIVITY_STORAGE_KEY } from './idle-timeout';
import SessionIdle from './session-idle.extension';

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

const TEN_MINUTES = 10 * 60 * 1000;
const KEEPALIVE_URL = `${restBaseUrl}/session?v=custom:(authenticated)`;
const mockNavigate = vi.mocked(navigate);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockClearCurrentUser = vi.mocked(clearCurrentUser);
const mockSetUserLanguage = vi.mocked(setUserLanguage);
const mockUseConfig = vi.mocked(useConfig);
const mockUseSession = vi.mocked(useSession);

function stamp(): string | null {
  return localStorage.getItem(HUMAN_ACTIVITY_STORAGE_KEY);
}

function activity(type: string) {
  window.dispatchEvent(new Event(type, { bubbles: true }));
}

/** The listener reads key and newValue. A plain event carries those without a StorageEvent init argument. */
function dispatchStorageChange(newValue: string | null) {
  const storageEvent = new Event('storage');
  Object.defineProperties(storageEvent, {
    key: { value: HUMAN_ACTIVITY_STORAGE_KEY },
    newValue: { value: newValue },
    storageArea: { value: localStorage },
  });
  window.dispatchEvent(storageEvent);
}

function keepaliveCalls() {
  return mockOpenmrsFetch.mock.calls.filter(([url]) => url === KEEPALIVE_URL);
}

function logoutCalls() {
  return mockOpenmrsFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await flush();
}

describe('SessionIdle', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    mockOpenmrsFetch.mockResolvedValue({} as FetchResponse<unknown>);
    mockUseSession.mockReturnValue({ authenticated: true, sessionId: 'xyz' } as Session);
    mockUseConfig.mockReturnValue({
      provider: { type: 'basic', loginUrl: '${openmrsSpaBase}/login' },
      session: { idleTimeoutMinutes: '10' },
    });
    vi.spyOn(document.documentElement, 'getAttribute').mockReturnValue('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('renders no visible UI and is mounted on the persistent top-nav slot', () => {
    const { container } = render(<SessionIdle />);
    expect(container).toBeEmptyDOMElement();

    expect(routes.extensions.find((extension) => extension.name === 'session-idle-watcher')).toMatchObject({
      slot: 'top-nav-info-slot',
      component: 'sessionIdle',
      online: true,
      offline: true,
    });
  });

  it('logs out through DELETE /ws/rest/v1/session after 10 minutes without human activity', async () => {
    render(<SessionIdle />);

    await advance(TEN_MINUTES - 15_000);
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    await advance(15_000);

    expect(mockOpenmrsFetch).toHaveBeenCalledWith(`${restBaseUrl}/session`, { method: 'DELETE' });
    expect(mockClearCurrentUser).toHaveBeenCalled();
    expect(mockSetUserLanguage).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '${openmrsSpaBase}/login' });
  });

  it.each([undefined, 'nope', '30', '600000'])(
    'uses 10 minutes when idleTimeoutMinutes is %s',
    async (idleTimeoutMinutes) => {
      mockUseConfig.mockReturnValue({
        provider: { type: 'basic', loginUrl: '${openmrsSpaBase}/login' },
        session: { idleTimeoutMinutes },
      });
      render(<SessionIdle />);

      await advance(TEN_MINUTES - 15_000);
      expect(mockOpenmrsFetch).not.toHaveBeenCalled();

      await advance(15_000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('honors a shorter configured timeout', async () => {
    mockUseConfig.mockReturnValue({
      provider: { type: 'basic', loginUrl: '${openmrsSpaBase}/login' },
      session: { idleTimeoutMinutes: '1' },
    });
    render(<SessionIdle />);

    await advance(45_000);
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    await advance(15_000);
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes the shared timestamp on pointer, keyboard, touch and scroll activity', async () => {
    render(<SessionIdle />);
    const initial = stamp();
    expect(initial).toBeTruthy();

    await advance(1_000);
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) {
      const before = Number(stamp());
      await advance(1_000);
      activity(type);
      expect(Number(stamp())).toBeGreaterThan(before);
    }
  });

  it('does not treat fetch or XMLHttpRequest as human activity', async () => {
    render(<SessionIdle />);
    const initial = stamp();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    await fetch('/ws/rest/v1/session');

    const send = vi.fn();
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(function MockXHR(this: { open: () => void; send: () => void }) {
        this.open = () => undefined;
        this.send = send;
      }),
    );
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/ws/rest/v1/session');
    xhr.send();
    expect(send).toHaveBeenCalled();

    expect(stamp()).toBe(initial);

    await advance(TEN_MINUTES);
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
  });

  it('resets the logout deadline when the person is active before the timeout', async () => {
    render(<SessionIdle />);

    await advance(9 * 60 * 1000);
    activity('pointerdown');
    expect(logoutCalls()).toHaveLength(0);

    await advance(9 * 60 * 1000);
    expect(logoutCalls()).toHaveLength(0);

    await advance(60 * 1000);
    expect(logoutCalls()).toHaveLength(1);
  });

  it('keeps the server session alive while the person keeps working without saving', async () => {
    render(<SessionIdle />);

    const refreshedAt = [Date.now()];
    mockOpenmrsFetch.mockImplementation(async (url) => {
      if (url === KEEPALIVE_URL) {
        refreshedAt.push(Date.now());
      }
      return {} as FetchResponse<unknown>;
    });

    // 20 minutes of typing in a form that makes no requests of its own.
    for (let minute = 1; minute <= 20; minute++) {
      await advance(60 * 1000);
      activity('keydown');
    }

    // The servlet session is 10 minutes since the last request. Refresh it well inside that.
    const gaps = refreshedAt.slice(1).map((at, i) => at - refreshedAt[i]);
    expect(refreshedAt.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(Date.now() - refreshedAt[refreshedAt.length - 1]).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(logoutCalls()).toHaveLength(0);
  });

  it('refreshes the server session for activity that came just before the keepalive interval', async () => {
    render(<SessionIdle />);

    await advance(3 * 60 * 1000 + 50 * 1000);
    activity('keydown');
    expect(keepaliveCalls()).toHaveLength(0);

    // The person then stops. The activity still has to reach the server,
    // or the servlet session would expire before the client-side deadline.
    await advance(30 * 1000);
    expect(keepaliveCalls()).toHaveLength(1);
  });

  it('does not refresh the server session without human activity', async () => {
    render(<SessionIdle />);

    await advance(TEN_MINUTES - 1_000);
    expect(keepaliveCalls()).toHaveLength(0);

    await advance(1_000);
    expect(keepaliveCalls()).toHaveLength(0);
    expect(logoutCalls()).toHaveLength(1);
  });

  it('does not let the keepalive count as human activity', async () => {
    render(<SessionIdle />);

    await advance(5 * 60 * 1000);
    activity('keydown');
    const lastHuman = stamp();
    await advance(60 * 1000);
    expect(keepaliveCalls()).toHaveLength(1);
    expect(stamp()).toBe(lastHuman);

    await advance(9 * 60 * 1000);
    expect(logoutCalls()).toHaveLength(1);
  });

  it('keeps the idle logout working when the keepalive request fails', async () => {
    mockOpenmrsFetch.mockImplementation(async (url) => {
      if (url === KEEPALIVE_URL) {
        throw new Error('network down');
      }
      return {} as FetchResponse<unknown>;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      render(<SessionIdle />);
      await advance(5 * 60 * 1000);
      activity('keydown');
      await advance(15_000);
      expect(keepaliveCalls()).toHaveLength(1);

      await advance(TEN_MINUTES);
      expect(logoutCalls()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not log out an idle tab while another tab has recorded activity', async () => {
    render(<SessionIdle />);

    await advance(9 * 60 * 1000);
    const peerActivity = String(Date.now());
    localStorage.setItem(HUMAN_ACTIVITY_STORAGE_KEY, peerActivity);
    dispatchStorageChange(peerActivity);

    await advance(9 * 60 * 1000);
    expect(logoutCalls()).toHaveLength(0);

    await advance(60 * 1000);
    expect(logoutCalls()).toHaveLength(1);
  });

  it('logs out when another tab clears the shared timestamp after idle logout', async () => {
    render(<SessionIdle />);
    localStorage.removeItem(HUMAN_ACTIVITY_STORAGE_KEY);
    dispatchStorageChange(null);

    await flush();
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(`${restBaseUrl}/session`, { method: 'DELETE' });
  });

  it('logs out immediately when a throttled tab becomes visible after the timeout', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    render(<SessionIdle />);
    vi.clearAllTimers();
    vi.setSystemTime(Date.now() + TEN_MINUTES + 1_000);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));

    await flush();
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
  });

  it('does not start the idle logout while the user is unauthenticated', async () => {
    mockUseSession.mockReturnValue({ authenticated: false } as Session);
    render(<SessionIdle />);

    await advance(TEN_MINUTES);
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    expect(stamp()).toBeNull();
  });

  it('stays mounted when the initial activity write throws and then fails closed', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    try {
      expect(() => render(<SessionIdle />)).not.toThrow();
      expect(stamp()).toBeNull();

      await advance(15_000 - 1);
      expect(mockOpenmrsFetch).not.toHaveBeenCalled();

      await advance(1);
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(`${restBaseUrl}/session`, { method: 'DELETE' });
    } finally {
      setItem.mockRestore();
    }
  });
});
