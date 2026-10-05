import { mutate } from 'swr';
import {
  clearCurrentUser,
  navigate,
  openmrsFetch,
  refetchCurrentUser,
  restBaseUrl,
  setUserLanguage,
} from '@openmrs/esm-framework';

export interface LogoutProvider {
  type: string;
  loginUrl?: string;
}

/** Where the user goes after the OpenMRS session has been invalidated, or was already gone. */
export function navigateAfterLogout(provider: LogoutProvider) {
  if (provider.type === 'custom') {
    navigate({ to: provider.loginUrl ?? '' });
  } else if (provider.type !== 'oauth2') {
    navigate({ to: '${openmrsSpaBase}/login' });
  }
}

/**
 * Invalidates the OpenMRS HttpSession, then returns to the unauthenticated flow.
 * DELETE /ws/rest/v1/session is the logout. A redirect alone is not.
 */
export async function completeLogout(provider: LogoutProvider) {
  await performLogout();

  const defaultLanguage = document.documentElement.getAttribute('data-default-lang');
  setUserLanguage({
    locale: defaultLanguage,
    authenticated: false,
    sessionId: '',
  });
  navigateAfterLogout(provider);
}

export async function performLogout() {
  await openmrsFetch(`${restBaseUrl}/session`, {
    method: 'DELETE',
  });

  // clear the SWR cache on logout, do not revalidate
  // taken from the SWR docs
  mutate(() => true, undefined, { revalidate: false });

  clearCurrentUser();
  try {
    await refetchCurrentUser();
  } catch (_) {
    // do nothing, silence the user-visible error
  }
}
