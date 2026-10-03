import { ERROR_NOTIFICATION } from '../support/landing';
import { DASHBOARD_APPS, loadLocalEsms } from '../support/local-esm';
import { api, asAdmin, type Auth, createUser, loginAs as loginAsUser, REST, runPassword } from '../support/users';

/**
 * The ICT Unit's audit log viewer (MOH ICT SOP control B3): @liberiaemr/esm-liberia-audit-log-app
 * over modules/liberiaemr's /ws/rest/v1/liberiaemr/auditlog, reading what the auditlog module
 * recorded.
 *
 * The admin account changes a global property and a location over REST; an ICT Auditor, a user
 * created here with that role alone, finds both in the viewer with their previous and new values
 * and downloads them as CSV. A user without the role sees no menu entry and gets 403 from the API.
 *
 * Until distribution/distro.properties pins a build of the app with the behaviour under test (here,
 * since LE-397, its home dashboard), loadAuditLogApp() serves this checkout's build in place of the
 * served one (support/local-esm.ts). CI's E2E job builds that dist first. Once the pin carries it,
 * the spec tests exactly what the distribution ships.
 */

const AUDIT = `${REST}/liberiaemr/auditlog`;

// Throwaway accounts on a disposable demo stack, created by this spec with a password generated
// per run: nothing here is a credential of any real server.
const run = `${Date.now()}`;
const password = runPassword('Audit');
const auditor = { username: `e2e-ict-auditor-${run}`, password };
const clerk = { username: `e2e-no-audit-${run}`, password };
const gpName = `liberiaemr.e2e.auditMarker${run}`;
const oldValue = `before-${run}`;
const newValue = `after-${run}`;

const loginAs = (user: Auth) => loginAsUser(user, 'audit-log');

/** Serve this checkout's build of the app, unless the served SPA already has it (see the header). */
const loadAuditLogApp = () =>
  loadLocalEsms(DASHBOARD_APPS.filter(({ module }) => module === '@liberiaemr/esm-liberia-audit-log-app'));

/** The saved file's text, once the browser has finished writing it. */
const waitForDownload = (prefix: string, attempts = 40): Cypress.Chainable<string> =>
  cy.task<string | null>('readDownload', prefix, { log: false }).then((text): Cypress.Chainable<string> => {
    if (text) {
      return cy.wrap(text);
    }
    if (attempts <= 0) {
      throw new Error(`no ${prefix}*.csv in the downloads folder`);
    }
    return cy.wait(500, { log: false }).then(() => waitForDownload(prefix, attempts - 1));
  });

const openAppMenu = () => cy.get('[aria-label="App Menu"], [aria-label="Open menu"]', { timeout: 30000 }).first().click();

// Opens the app menu until the named entry is visible. Before LE-395 the home page's queue widget
// failed for the ICT Auditor with a 403 whose toast could land just as the menu opened and close it
// again (seen in CI, not locally); the retry stays as a guard against any late re-render. A user
// without the entry never gets here.
const openAppMenuTo = (entry: string, attempts = 4) => {
  openAppMenu();
  cy.wait(2000);
  cy.get('body').then(($body) => {
    const shown = $body.find('.cds--header-panel--expanded a').filter((_, a) => Cypress.$(a).is(':visible') && a.textContent?.trim() === entry);
    if (!shown.length && attempts > 1) {
      openAppMenuTo(entry, attempts - 1);
    }
  });
};

describe('Audit log', () => {
  let locationUuid: string;

  before(() => {
    createUser(auditor, ['ICT Auditor']);
    // A national role that signs in to O3 but holds no audit privilege.
    createUser(clerk, ['Sync Conflict Reviewer']);

    // The changes the auditor must find: a global property set and then changed, and a location
    // renamed. Both through REST as the admin, as an administrator would.
    asAdmin('POST', `${REST}/systemsetting`, { property: gpName, value: oldValue, description: 'Audit log E2E marker' });
    asAdmin('POST', `${REST}/systemsetting/${gpName}`, { value: newValue });
    asAdmin('POST', `${REST}/location`, { name: `E2E Audit Ward ${run}`, description: oldValue }).then(({ body }) => {
      locationUuid = body.uuid;
      asAdmin('POST', `${REST}/location/${locationUuid}`, { description: newValue });
    });
  });

  it('records the change with its previous and new values, for the ICT Auditor through the API', () => {
    api(auditor, 'GET', `${AUDIT}?type=org.openmrs.GlobalProperty&action=UPDATED&user=admin&limit=200`).then(
      ({ status, body }) => {
        expect(status).to.eq(200);
        const entry = body.results.find((row: { identifier: string }) => row.identifier === gpName);
        expect(entry, 'the global property update').to.exist;
        // The demo admin has system ID "admin" and an empty username.
        expect(entry.user.username || entry.user.systemId).to.eq('admin');
        api(auditor, 'GET', `${AUDIT}/${entry.uuid}`).then(({ body: detail }) => {
          const change = detail.changes.find((c: { property: string }) => c.property === 'propertyValue');
          expect(change.previous).to.eq(oldValue);
          expect(change.current).to.eq(newValue);
          expect(change.redacted).to.eq(false);
        });
      },
    );
    // The role reads the audit log, not patient records.
    api(auditor, 'GET', `${REST}/patient?q=a`, undefined, false).its('status').should('eq', 403);
    api(auditor, 'GET', `${REST}/encounter?q=a`, undefined, false).its('status').should('be.oneOf', [400, 403]);
  });

  it('shows the ICT Auditor the menu entry and the change, with its old and new values', () => {
    loginAs(auditor);
    loadAuditLogApp();
    cy.visit('/openmrs/spa/home');
    // Since LE-397 the role lands on its audit log dashboard, which the side navigation links as
    // "Audit log" too; this is the menu's entry, to the page's own route.
    cy.location('pathname', { timeout: 30000 }).should('eq', '/openmrs/spa/home/audit-log');
    openAppMenuTo('Audit log');
    cy.get('.cds--header-panel--expanded', { timeout: 30000 }).contains('a', 'Audit log').should('be.visible').click();
    cy.url().should('include', '/openmrs/spa/audit-log');
    cy.contains('h3', 'Audit log', { timeout: 30000 }).should('be.visible');
    // Since LE-395 the home page shows the role no queue dashboard, so no 403 toast follows it here.
    cy.get(ERROR_NOTIFICATION).should('not.exist');

    // Matches only the filtered request. The page's own unfiltered first load can still be in
    // flight when this is set, and a plain `${AUDIT}?*` alias then caught that one instead.
    cy.intercept({
      method: 'GET',
      pathname: AUDIT,
      query: { type: 'org.openmrs.GlobalProperty', action: 'UPDATED', user: 'admin' },
    }).as('list');
    cy.get('#audit-type').select('org.openmrs.GlobalProperty');
    cy.get('#audit-action').select('UPDATED');
    cy.get('#audit-user').type('admin');
    cy.contains('button', 'Apply filters').click();
    cy.wait('@list', { timeout: 30000 });

    cy.contains('[data-testid="audit-row"]', gpName, { timeout: 30000 }).should('be.visible');
    // Scoped to the visible row: in CI the label matched two elements (a second, hidden one).
    cy.contains('[data-testid="audit-row"]', gpName).find(`button[aria-label="Open entry ${gpName}"]`).first().click();
    cy.get('[data-testid="audit-detail"]', { timeout: 30000 }).within(() => {
      cy.contains('[data-testid="audit-change"]', 'propertyValue').within(() => {
        cy.contains(oldValue).should('be.visible');
        cy.contains(newValue).should('be.visible');
      });
      cy.contains('admin').should('be.visible');
    });
  });

  it('finds the edited location by type and shows the description it had', () => {
    // The table shows a location by its database id, which REST does not expose; the auditor's
    // own API read finds it by the change it records.
    api(auditor, 'GET', `${AUDIT}?type=Location&action=UPDATED&user=admin&limit=50`).then(({ body }) => {
      const entries: Array<{ uuid: string; identifier: string }> = body.results;
      const found: Array<string> = [];
      entries.forEach((entry) =>
        api(auditor, 'GET', `${AUDIT}/${entry.uuid}`).then(({ body: detail }) => {
          const change = detail.changes.find((c: { property: string }) => c.property === 'description');
          if (change?.current === newValue && change?.previous === oldValue) {
            found.push(entry.identifier);
          }
        }),
      );
      cy.then(() => {
        expect(found, 'the location update').to.have.length(1);
        loginAs(auditor);
        loadAuditLogApp();
        cy.visit('/openmrs/spa/audit-log');
        cy.get('#audit-type', { timeout: 30000 }).select('org.openmrs.Location');
        cy.get('#audit-action').select('UPDATED');
        cy.contains('button', 'Apply filters').click();
        cy.get(`button[aria-label="Open entry ${found[0]}"]`, { timeout: 30000 }).first().click();
        cy.get('[data-testid="audit-detail"]', { timeout: 30000 }).within(() => {
          cy.contains('[data-testid="audit-change"]', 'description').within(() => {
            cy.contains(oldValue).should('be.visible');
            cy.contains(newValue).should('be.visible');
          });
        });
      });
    });
  });

  it('downloads the filtered entries as CSV', () => {
    loginAs(auditor);
    loadAuditLogApp();
    cy.visit('/openmrs/spa/audit-log');
    cy.get('#audit-type', { timeout: 30000 }).select('org.openmrs.GlobalProperty');
    cy.get('#audit-user').type('admin');
    cy.contains('button', 'Apply filters').click();
    cy.contains('[data-testid="audit-row"]', gpName, { timeout: 30000 }).should('be.visible');

    cy.get('[data-testid="audit-export"]')
      .should('have.attr', 'href')
      .and('include', '/openmrs/ws/rest/v1/liberiaemr/auditlog/export?')
      .and('include', 'type=org.openmrs.GlobalProperty')
      .then((href) => {
        // The file the link serves, with the auditor's session.
        cy.request(String(href)).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.headers['content-type']).to.include('text/csv');
          expect(String(res.headers['content-disposition'])).to.match(/attachment; filename="audit-log-.*\.csv"/);
          const lines = String(res.body).split('\r\n');
          expect(lines[0]).to.eq('date,action,type,identifier,username,user_uuid,uuid,parent_uuid,values');
          const line = lines.find((l) => l.includes(gpName) && l.includes(',UPDATED,'));
          expect(line, 'the global property update').to.exist;
          expect(line).to.include(`propertyValue: ${oldValue} -> ${newValue}`);
        });
      });

    // And the browser saves it.
    cy.task('clearDownloads');
    cy.get('[data-testid="audit-export"]').click();
    waitForDownload('audit-log-').then((csv) => {
      expect(csv, 'downloaded audit-log-*.csv').to.be.a('string');
      expect(csv).to.include(gpName);
    });
  });

  it('shows no menu entry to a user without the ICT Auditor role, and the API refuses them', () => {
    api(clerk, 'GET', AUDIT, undefined, false).its('status').should('eq', 403);
    api(clerk, 'GET', `${AUDIT}/export`, undefined, false).its('status').should('eq', 403);
    api(clerk, 'GET', `${AUDIT}/types`, undefined, false).its('status').should('eq', 403);

    loginAs(clerk);
    loadAuditLogApp();
    cy.visit('/openmrs/spa/home');
    openAppMenu();
    // The menu has rendered its other entries before the absence of this one means anything.
    // (Since LE-395 this role has no home dashboard, so the home page's side navigation no longer
    // holds a link; the open app menu panel's own entries are what count.)
    cy.get('.cds--header-panel--expanded a, [aria-label="App Menu"] a, [role="dialog"] a, nav a', { timeout: 30000 })
      .should('have.length.greaterThan', 0);
    cy.contains('a', 'Audit log').should('not.exist');

    cy.visit('/openmrs/spa/audit-log');
    cy.contains('You cannot read the audit log', { timeout: 30000 }).should('be.visible');
    cy.get('[data-testid="audit-export"]').should('not.exist');
  });
});
