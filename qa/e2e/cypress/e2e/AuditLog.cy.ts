import AuthenticationPage from '../pages/AuthenticationPage';

/**
 * The ICT Unit's audit log viewer (MOH ICT SOP control B3): @liberiaemr/esm-liberia-audit-log-app
 * over modules/liberiaemr's /ws/rest/v1/liberiaemr/auditlog, reading what the auditlog module
 * recorded.
 *
 * The admin account changes a global property and a location over REST; an ICT Auditor, a user
 * created here with that role alone, finds both in the viewer with their previous and new values
 * and downloads them as CSV. A user without the role sees no menu entry and gets 403 from the API.
 *
 * Until the app is pinned in distribution/distro.properties, the SPA the gateway serves does not
 * include it (a new package has no published version before its first merge). Then, and only
 * then, loadAuditLogApp() adds this checkout's build to the page: it intercepts importmap.json and
 * routes.registry.json to add the module, and serves packages/esm-liberia-audit-log-app/dist/
 * under /openmrs/spa/__e2e__/. CI's E2E job builds that dist first. Once the app is pinned, the
 * served import map has it and the spec tests exactly what the distribution ships.
 */

const MODULE = '@liberiaemr/esm-liberia-audit-log-app';
const DIST = '../../packages/esm-liberia-audit-log-app/dist';
// cy.intercept's fixture paths are relative to cypress/fixtures.
const DIST_FIXTURE = '../../../../packages/esm-liberia-audit-log-app/dist';
const OVERLAY = '__e2e__/esm-liberia-audit-log-app';
const REST = '/openmrs/ws/rest/v1';
const AUDIT = `${REST}/liberiaemr/auditlog`;

// Throwaway accounts on a disposable demo stack, created by this spec with a password generated
// per run: nothing here is a credential of any real server.
const run = `${Date.now()}`;
const password = `Le${Cypress._.random(100000, 999999)}!aB`;
const auditor = { username: `e2e-ict-auditor-${run}`, password };
const clerk = { username: `e2e-no-audit-${run}`, password };
const gpName = `liberiaemr.e2e.auditMarker${run}`;
const oldValue = `before-${run}`;
const newValue = `after-${run}`;

type Auth = { username: string; password: string };

const admin = (): Cypress.Chainable<Auth> =>
  cy.env<{ USERNAME?: string; PASSWORD?: string }>(['USERNAME', 'PASSWORD']).then(({ USERNAME, PASSWORD }) => {
    if (!USERNAME || !PASSWORD) {
      throw new Error('Missing Cypress credentials: set CYPRESS_USERNAME/CYPRESS_PASSWORD');
    }
    return { username: USERNAME, password: PASSWORD };
  });

const api = (auth: Auth, method: string, url: string, body?: Cypress.RequestBody, failOnStatusCode = true) =>
  cy.request({ method, url, body, auth, failOnStatusCode, headers: { Accept: 'application/json' } });

const asAdmin = (method: string, url: string, body?: Cypress.RequestBody) =>
  admin().then((auth) => api(auth, method, url, body));

/** A user with the given roles (by name), created through REST as the admin. */
const createUser = (user: Auth, roleNames: Array<string>) => {
  const roles: Array<string> = [];
  roleNames.forEach((name) =>
    asAdmin('GET', `${REST}/role?q=${encodeURIComponent(name)}&v=custom:(uuid,display)`).then(({ body }) => {
      const role = body.results.find((candidate: { display: string }) => candidate.display === name);
      expect(role, `role ${name}`).to.exist;
      roles.push(role.uuid);
    }),
  );
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

const loginAs = (user: Auth) =>
  cy.session(['audit-log', user.username], () => {
    const page = new AuthenticationPage();
    page.visitPage();
    page.verifyLoginPageLoaded();
    page.login(user.username, user.password);
  });

/** Serve this checkout's build of the app, unless the SPA already includes it (see the header). */
const loadAuditLogApp = () =>
  cy.request('/openmrs/spa/importmap.json').then(({ body }) => {
    if (body.imports?.[MODULE]) {
      return;
    }
    cy.readFile(`${DIST}/routes.json`, { log: false }).then((routes) => {
      // No cached copy: a 304 would carry no body to add the module to.
      const fresh = (req: { headers: Record<string, unknown> }) => {
        delete req.headers['if-none-match'];
        delete req.headers['if-modified-since'];
      };
      cy.intercept('GET', '**/openmrs/spa/importmap.json*', (req) => {
        fresh(req);
        req.continue((res) => {
          const map = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
          map.imports[MODULE] = `./${OVERLAY}/liberiaemr-esm-liberia-audit-log-app.js`;
          res.body = map;
        });
      });
      cy.intercept('GET', '**/openmrs/spa/routes.registry.json*', (req) => {
        fresh(req);
        req.continue((res) => {
          const registry = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
          registry[MODULE] = routes;
          res.body = registry;
        });
      });
      cy.intercept('GET', `**/openmrs/spa/${OVERLAY}/*`, (req) => {
        const file = new URL(req.url).pathname.split('/').pop() ?? '';
        req.reply({
          fixture: `${DIST_FIXTURE}/${file}`,
          headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/javascript' },
        });
      });
    });
  });

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

describe('Audit log', () => {
  let locationUuid: string;

  before(() => {
    createUser(auditor, ['ICT Auditor']);
    // An ordinary facility account (content-common): it can sign in and choose a location, but
    // holds no audit privilege.
    createUser(clerk, ['Records Officer']);

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
        expect(entry.user.username).to.eq('admin');
        api(auditor, 'GET', `${AUDIT}/${entry.uuid}`).then(({ body: detail }) => {
          const change = detail.changes.find((c: { property: string }) => c.property === 'propertyValue');
          expect(change.previous).to.eq(oldValue);
          expect(change.current).to.eq(newValue);
          expect(change.redacted).to.eq(false);
        });
      },
    );
  });

  it('shows the ICT Auditor the menu entry and the change, with its old and new values', () => {
    loginAs(auditor);
    loadAuditLogApp();
    cy.visit('/openmrs/spa/home');
    openAppMenu();
    cy.contains('a', 'Audit log', { timeout: 30000 }).should('be.visible').click();
    cy.url().should('include', '/openmrs/spa/audit-log');
    cy.contains('h3', 'Audit log', { timeout: 30000 }).should('be.visible');

    cy.intercept('GET', `${AUDIT}?*`).as('list');
    cy.get('#audit-type').select('org.openmrs.GlobalProperty');
    cy.get('#audit-action').select('UPDATED');
    cy.get('#audit-user').type('admin');
    cy.contains('button', 'Apply filters').click();
    cy.wait('@list').its('request.url').should('include', 'type=org.openmrs.GlobalProperty').and('include', 'user=admin');

    cy.contains('[data-testid="audit-row"]', gpName, { timeout: 30000 }).should('be.visible');
    cy.get(`button[aria-label="Open entry ${gpName}"]`).click();
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
    cy.get('[aria-label="App Menu"] a, [role="dialog"] a, nav a', { timeout: 30000 }).should('have.length.greaterThan', 0);
    cy.contains('a', 'Audit log').should('not.exist');

    cy.visit('/openmrs/spa/audit-log');
    cy.contains('You cannot read the audit log', { timeout: 30000 }).should('be.visible');
    cy.get('[data-testid="audit-export"]').should('not.exist');
  });
});
