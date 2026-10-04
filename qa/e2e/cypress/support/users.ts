import AuthenticationPage from '../pages/AuthenticationPage';

/**
 * Throwaway users for specs that test what a role can and cannot do (AuditLog.cy.ts,
 * RoleSignIn.cy.ts). The accounts are created on a disposable demo stack with a password the
 * spec generates per run: nothing here is a credential of any real server.
 */

export const REST = '/openmrs/ws/rest/v1';

export type Auth = { username: string; password: string };

/** A password that meets the demo stack's password policy, new on every run. */
export const runPassword = (prefix: string) =>
  `${prefix}-${Cypress._.random(100000, 999999)}-e2E!${Cypress._.random(1000, 9999)}`;

export const admin = (): Cypress.Chainable<Auth> =>
  cy.env<{ USERNAME?: string; PASSWORD?: string }>(['USERNAME', 'PASSWORD']).then(({ USERNAME, PASSWORD }) => {
    if (!USERNAME || !PASSWORD) {
      throw new Error('Missing Cypress credentials: set CYPRESS_USERNAME/CYPRESS_PASSWORD');
    }
    return { username: USERNAME, password: PASSWORD };
  });

/**
 * A REST call as this user alone. cy.request sends the browser's cookies, and OpenMRS answers a
 * request carrying an authenticated JSESSIONID as that session's user whatever the Authorization
 * header says; so the session cookie goes first, or every call would run as whoever called last.
 */
export const api = (auth: Auth, method: string, url: string, body?: Cypress.RequestBody, failOnStatusCode = true) =>
  cy
    .clearCookie('JSESSIONID')
    .then(() => cy.request({ method, url, body, auth, failOnStatusCode, headers: { Accept: 'application/json' } }));

export const asAdmin = (method: string, url: string, body?: Cypress.RequestBody) =>
  admin().then((auth) => api(auth, method, url, body));

/** A user holding exactly the given roles (by name), created through REST as the admin. */
export const createUser = (user: Auth, roleNames: Array<string>) => {
  const roles: Array<string> = [];
  // The role resource has no search by name; list them all (a few dozen) and pick by name.
  asAdmin('GET', `${REST}/role?v=custom:(uuid,display)&limit=100`).then(({ body }) => {
    roleNames.forEach((name) => {
      const role = body.results.find((candidate: { display: string }) => candidate.display === name);
      expect(role, `role ${name}`).to.exist;
      roles.push(role.uuid);
    });
  });
  return cy.then(() =>
    asAdmin('POST', `${REST}/user`, {
      username: user.username,
      password: user.password,
      person: {
        names: [{ givenName: 'E2E', familyName: user.username.replace(/[^A-Za-z]/g, '') }],
        gender: 'U',
      },
      roles,
    }).its('status').should('eq', 201),
  );
};

/**
 * Signs in through the real login page (username, password, then the location picker), cached
 * per spec and user with cy.session. `cacheKey` keeps two specs' sessions apart.
 */
export const loginAs = (user: Auth, cacheKey: string) =>
  cy.session([cacheKey, user.username], () => {
    const page = new AuthenticationPage();
    page.visitPage();
    page.verifyLoginPageLoaded();
    page.login(user.username, user.password);
  });
