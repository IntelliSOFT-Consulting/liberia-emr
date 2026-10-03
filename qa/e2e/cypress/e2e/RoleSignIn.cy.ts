import { api, asAdmin, type Auth, createUser, loginAs, REST, runPassword } from '../support/users';

/**
 * Every Liberia login role can sign in to O3 (LE-392).
 *
 * O3 sends a user back to the login page unless /ws/rest/v1/session carries the user's own person,
 * which the REST module renders only for holders of Get People. On main before LE-392 that was
 * every login role but the ICT Auditor, and no spec noticed because they all sign in as admin. Here
 * each role gets a user holding that role ALONE, who signs in through the real login page and
 * location picker and must land on the home page with the app shell, and stay there.
 *
 * modules/liberiaemr's OwnPersonSessionAdvice puts the own person back without granting Get People,
 * so the non-clinical roles sign in while /person stays closed to them; the last tests check that,
 * and a sample of what each role must NOT read.
 *
 * The home page's service queue widget answers 403 (or 500) to most of these roles and shows a
 * toast. That is a question of what each role should see, not of signing in, so it is not asserted.
 */

type LoginRole = { role: string; clinical: boolean };

// Every role a person signs in with. Sync Sender and Sync Receiver are service accounts.
const ROLES: Array<LoginRole> = [
  { role: 'Records Officer', clinical: true },
  { role: 'Nurse', clinical: true },
  { role: 'Clinician', clinical: true },
  { role: 'Midwife', clinical: true },
  { role: 'Pharmacist', clinical: true },
  { role: 'Lab Technician', clinical: true },
  { role: 'National Reporting Officer', clinical: false },
  { role: 'Sync Administrator', clinical: false },
  { role: 'ICT Auditor', clinical: false },
  { role: 'Sync Conflict Reviewer', clinical: false },
];

// Throwaway accounts on a disposable demo stack, with a password generated per run.
const run = `${Date.now()}`;
const password = runPassword('Role');
const userFor = (role: string): Auth => ({
  username: `e2e-${role.replace(/[^A-Za-z]/g, '').toLowerCase()}-${run}`,
  password,
});

/** The signed-in user's own person, from the session the browser holds. */
const sessionPerson = () =>
  cy.request(`${REST}/session`).then(({ body }) => {
    expect(body.authenticated, 'authenticated').to.eq(true);
    expect(body.sessionLocation, 'session location').to.exist;
    expect(body.user.person, 'session user.person').to.exist;
    return body.user.person as { uuid: string; display: string };
  });

describe('Sign-in for every login role', () => {
  before(() => {
    ROLES.forEach(({ role }) => createUser(userFor(role), [role]));
  });

  ROLES.forEach(({ role }) => {
    it(`signs in a user holding only ${role} and keeps them on the home page`, () => {
      const user = userFor(role);
      loginAs(user, 'role-sign-in');
      cy.visit('/openmrs/spa/home');

      // The signed-in home page: the location chosen at login in the header and the home
      // dashboard's navigation. A user O3 does not accept is sent to /login instead.
      cy.location('pathname', { timeout: 30000 }).should('match', /^\/openmrs\/spa\/home/);
      cy.get('header', { timeout: 30000 }).should('be.visible');
      cy.contains('a', 'Service queues', { timeout: 30000 }).should('be.visible');
      cy.get('[aria-label="App Menu"], [aria-label="Open menu"]', { timeout: 30000 }).should('exist');
      // O3 decides once the session has loaded; give it the time it took to bounce users before.
      cy.wait(5000);
      cy.location('pathname').should('match', /^\/openmrs\/spa\/home/);

      sessionPerson().then((person) => {
        expect(person.display, 'own name').to.include('E2E');
      });
    });
  });

  it('opens person records to the clinical roles only', () => {
    ROLES.forEach(({ role, clinical }) => {
      api(userFor(role), 'GET', `${REST}/person?q=E2E&limit=1`, undefined, false)
        .its('status')
        .should('eq', clinical || role === 'Sync Conflict Reviewer' ? 200 : 403);
    });
  });

  it('gives a role without Get People its own person in the session and nothing more', () => {
    const officer = userFor('National Reporting Officer');
    api(officer, 'GET', `${REST}/session`).then(({ body }) => {
      const person = body.user.person;
      expect(Object.keys(person).sort()).to.deep.eq(['display', 'uuid']);
      // The session names it; reading it, or any other person, is still refused.
      api(officer, 'GET', `${REST}/person/${person.uuid}`, undefined, false).its('status').should('eq', 403);
    });
    api(officer, 'GET', `${REST}/person?q=E2E`, undefined, false).its('status').should('eq', 403);
    api(officer, 'GET', `${REST}/patient?q=E2E`, undefined, false).its('status').should('eq', 403);
    // An admin's session is the REST module's own rendering, untouched.
    asAdmin('GET', `${REST}/session`).its('body.user.person.uuid').should('be.a', 'string');
  });

  it('refuses each sampled role what it must not read', () => {
    // Registration and dispensing, not clinical observations. (A search by an unknown patient
    // answers 200 with nothing before any privilege check, so this searches by text.)
    ['Records Officer', 'Pharmacist'].forEach((role) => {
      api(userFor(role), 'GET', `${REST}/obs?q=E2E`, undefined, false).its('status').should('eq', 403);
    });
    // The Nurse, who records vitals, can.
    api(userFor('Nurse'), 'GET', `${REST}/obs?q=E2E`).its('status').should('eq', 200);
    // Aggregate reports and sync operations, not patients.
    ['National Reporting Officer', 'Sync Administrator', 'ICT Auditor'].forEach((role) => {
      api(userFor(role), 'GET', `${REST}/patient?q=E2E`, undefined, false).its('status').should('eq', 403);
    });
  });
});
