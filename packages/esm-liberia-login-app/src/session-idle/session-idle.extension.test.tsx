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
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    await advance(9 * 60 * 1000);
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    await advance(60 * 1000);
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
  });

  it('does not log out an idle tab while another tab has recorded activity', async () => {
    render(<SessionIdle />);

    await advance(9 * 60 * 1000);
    const peerActivity = String(Date.now());
    localStorage.setItem(HUMAN_ACTIVITY_STORAGE_KEY, peerActivity);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: HUMAN_ACTIVITY_STORAGE_KEY,
        newValue: peerActivity,
        storageArea: localStorage,
      }),
    );

    await advance(9 * 60 * 1000);
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();

    await advance(60 * 1000);
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
  });

  it('logs out when another tab clears the shared timestamp after idle logout', async () => {
    render(<SessionIdle />);
    localStorage.removeItem(HUMAN_ACTIVITY_STORAGE_KEY);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: HUMAN_ACTIVITY_STORAGE_KEY,
        newValue: null,
        storageArea: localStorage,
      }),
    );

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
});
