/**
 * What a signed-in user's landing page must not do: answer an error from the backend, or show an
 * error notification (RoleSignIn.cy.ts, Queue.cy.ts; LE-395).
 */

/** Carbon's error toast, snackbar and inline notification all carry a `…notification--error` class. */
export const ERROR_NOTIFICATION = '[class*="notification--error"]';

/**
 * Starts recording every REST and FHIR call that fails (status 400 or above) from now on, as
 * "METHOD path status: message". Call it before cy.visit; read the array after the page settles.
 */
export const recordFailedCalls = () => {
  const failed: Array<string> = [];
  cy.intercept({ url: '**/openmrs/ws/**' }, (req) => {
    req.continue((res) => {
      if (res.statusCode >= 400) {
        const body = res.body as { error?: { message?: string } } | undefined;
        const path = req.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
        failed.push(`${req.method} ${path} ${res.statusCode}: ${body?.error?.message ?? ''}`);
      }
    });
  });
  return failed;
};
