import { ERROR_NOTIFICATION, recordFailedCalls } from '../support/landing';
import { DASHBOARD_APPS, loadLocalEsms } from '../support/local-esm';
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
 * Each role's landing page must also load cleanly (LE-395): no REST call answering an error and no
 * error notification. The six facility roles work the patient queue and land on the service queues
 * dashboard. The national roles hold no queue privilege, so config-national.json hides every
 * clinical dashboard from them; each lands instead on its own app's dashboard (LE-397), never on the
 * home app's "does not exist" tile. This stack is a facility, so the two sync pages say they are
 * shown at central; that is their page, not an error.
 *
 * Those dashboards are registered by packages/esm-liberia-*, which reach the served SPA only once
 * distro.properties pins a build that has them. Until then loadLocalEsms() serves this checkout's
 * builds (support/local-esm.ts), so this spec passes on the PR that adds them and, after the
 * re-pin, tests the pinned builds unchanged.
 */

type LoginRole = {
  role: string;
  clinical: boolean;
  /** A national role's home dashboard (/home/<dashboard>) and text its page shows on this stack. */
  dashboard?: { name: string; title: string; shows: string | RegExp };
};

// Every role a person signs in with. Sync Sender and Sync Receiver are service accounts. The
// clinical roles are also the ones that work the service queue.
const ROLES: Array<LoginRole> = [
  { role: 'Records Officer', clinical: true },
  { role: 'Nurse', clinical: true },
  { role: 'Clinician', clinical: true },
  { role: 'Midwife', clinical: true },
  { role: 'Pharmacist', clinical: true },
  { role: 'Lab Technician', clinical: true },
  {
    role: 'National Reporting Officer',
    clinical: false,
    dashboard: { name: 'indicator-reports', title: 'Indicator reports', shows: 'Report data' },
  },
  {
    role: 'Sync Administrator',
    clinical: false,
    dashboard: { name: 'sync-status', title: 'Sync status', shows: 'Sync status is not available on this server' },
  },
  {
    role: 'ICT Auditor',
    clinical: false,
    dashboard: { name: 'audit-log', title: 'Audit log', shows: 'Apply filters' },
  },
  {
    role: 'Sync Conflict Reviewer',
    clinical: false,
    dashboard: {
      name: 'sync-conflicts',
      title: 'Sync conflicts',
      shows: 'Sync conflicts are not available on this server',
    },
  },
];

const NOT_FOUND = 'The dashboard you are looking for does not exist';
const openAppMenu = () => cy.get('[aria-label="App Menu"], [aria-label="Open menu"]', { timeout: 30000 }).first().click();


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

  ROLES.forEach(({ role, clinical, dashboard }) => {
    it(`signs in a user holding only ${role} and keeps them on a home page that loads cleanly`, () => {
      const user = userFor(role);
      loginAs(user, 'role-sign-in');
      loadLocalEsms(DASHBOARD_APPS);
      const failed = recordFailedCalls();
      cy.visit('/openmrs/spa/home');

      // The signed-in home page: the location chosen at login in the header and the app menu.
      // A user O3 does not accept is sent to /login instead.
      cy.location('pathname', { timeout: 30000 }).should('match', /^\/openmrs\/spa\/home/);
      cy.get('header', { timeout: 30000 }).should('be.visible');
      cy.get('[aria-label="App Menu"], [aria-label="Open menu"]', { timeout: 30000 }).should('exist');
      if (clinical) {
        // The queue roles land on the service queues dashboard and its table loads.
        cy.location('pathname', { timeout: 30000 }).should('eq', '/openmrs/spa/home/service-queues');
        cy.contains(/patients currently in queue/i, { timeout: 30000 }).should('be.visible');
      } else {
        // Its own dashboard, linked in the home page's side navigation, and never the 404 tile.
        expect(dashboard, `${role}'s dashboard`).to.exist;
        const { name, title, shows } = dashboard!;
        cy.location('pathname', { timeout: 30000 }).should('eq', `/openmrs/spa/home/${name}`);
        cy.contains(shows, { timeout: 30000 }).should('be.visible');
        cy.get(`a[href$="/home/${name}"]`).should('contain.text', title);
        cy.contains('a', 'Service queues').should('not.exist');
      }
      // O3 decides once the session has loaded; give it the time it took to bounce users before.
      // The same wait lets the dashboard's requests, and any toast they raise, arrive.
      cy.wait(5000);
      cy.location('pathname').should('match', /^\/openmrs\/spa\/home/);
      cy.contains(NOT_FOUND).should('not.exist');
      cy.get(ERROR_NOTIFICATION).should('not.exist');
      cy.wrap(failed).should('deep.equal', []);

      sessionPerson().then((person) => {
        expect(person.display, 'own name').to.include('E2E');
      });
    });
  });

  it('opens the app menu for the Sync Conflict Reviewer with only entries it can use, and no 403', () => {
    loginAs(userFor('Sync Conflict Reviewer'), 'role-sign-in');
    loadLocalEsms(DASHBOARD_APPS);
    const failed = recordFailedCalls();
    cy.visit('/openmrs/spa/home');
    cy.location('pathname', { timeout: 30000 }).should('eq', '/openmrs/spa/home/sync-conflicts');
    cy.contains('Sync conflicts are not available on this server', { timeout: 30000 }).should('be.visible');

    openAppMenu();
    // The panel has rendered its entries before the absence of any one of them means anything.
    cy.get('.cds--header-panel--expanded a', { timeout: 30000 }).should('have.length.greaterThan', 0);
    // Pages it holds no privilege for (config-national.json), and the MFL sync, whose status it
    // may not read (routes.json): listing them only led to a refusal.
    ['System Administration', 'Queue screen', 'Dispensing', 'Master Facility List sync', 'Audit log'].forEach(
      (entry) => cy.get('.cds--header-panel--expanded').contains('a', entry).should('not.exist'),
    );
    // Opening the menu asked the server for nothing it refuses (before LE-397, mfl/status: 403).
    cy.wait(5000);
    cy.get(ERROR_NOTIFICATION).should('not.exist');
    cy.wrap(failed).should('deep.equal', []);
  });

  it('gives the queue roles the queue and visit privileges their work needs, and no other role', () => {
    ROLES.forEach(({ role, clinical }) => {
      const user = userFor(role);
      api(user, 'GET', `${REST}/queue?v=custom:(uuid)`, undefined, false).its('status').should('eq', clinical ? 200 : 403);
      api(user, 'GET', `${REST}/queue-entry?isEnded=false&v=custom:(uuid)`, undefined, false)
        .its('status')
        .should('eq', clinical ? 200 : 403);
      api(user, 'GET', `${REST}/visit?includeInactive=false&v=custom:(uuid)`, undefined, false)
        .its('status')
        .should('eq', clinical ? 200 : 403);
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
