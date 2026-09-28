import { loginWithSession } from '../support/session';
import { mflApi, stubInternalUrl, stubScenario, syncFixture, waitForRun } from '../support/mfl';

// The MFL sync admin page (LE-323, PR #158): the mfl-sync route in esm-liberia-sync-status-app,
// ADR 0009 §9. The backend syncs from the stub in qa/api/mfl-stub/. Text and ids are the ones
// LE-323 renders (translations/en.json, mfl-settings.component.tsx).
describe('MFL sync admin page', () => {
  const page = '/openmrs/spa/mfl-sync';
  const errorNotification = '.cds--inline-notification--error, .cds--actionable-notification--error';

  before(() => {
    syncFixture();
  });

  beforeEach(() => {
    loginWithSession();
    stubScenario('normal');
  });

  it('shows the configured MFL, the account and the last run, and never a password field', () => {
    cy.visit(page);
    cy.contains('Master Facility List sync', { timeout: 30000 }).should('be.visible');
    stubInternalUrl().then((url) => cy.contains(url).should('be.visible'));
    cy.contains('qa-mfl-stub').should('be.visible');
    cy.contains('Last run').should('be.visible');
    cy.contains(/The MFL account and password are a deployment secret/).should('be.visible');
    cy.get('input[type="password"]').should('not.exist');
  });

  it('tests the connection and reports the DHIS2 version and facility count', () => {
    cy.intercept('POST', '**/liberiaemr/mfl/test-connection').as('testConnection');
    cy.visit(page);
    cy.contains('button', 'Test connection', { timeout: 30000 }).click();
    cy.wait('@testConnection').its('response.statusCode').should('eq', 200);
    cy.contains('Connected to the MFL', { timeout: 30000 }).should('be.visible');
    cy.contains('DHIS2 2.40.4.1, 16 facilities.').should('be.visible');
  });

  it('reports a refused connection without breaking the page', () => {
    stubScenario('unauthorized');
    cy.intercept('POST', '**/liberiaemr/mfl/test-connection').as('testConnection');
    cy.visit(page);
    cy.contains('button', 'Test connection', { timeout: 30000 }).click();
    cy.wait('@testConnection').its('response.body.ok').should('eq', false);
    cy.contains('Could not connect to the MFL', { timeout: 30000 }).should('be.visible');
    cy.contains('button', 'Sync now').should('be.visible');
  });

  it('starts a dry run and lists it in the history as a dry run', () => {
    cy.intercept('POST', '**/liberiaemr/mfl/runs').as('startRun');
    cy.visit(page);
    cy.contains('button', 'Dry run', { timeout: 30000 }).click();
    cy.wait('@startRun').then(({ request, response }) => {
      expect(request.body.dryRun).to.eq(true);
      expect(response?.statusCode).to.eq(202);
      waitForRun(response?.body.id);
    });
    cy.reload();
    cy.contains('Run history', { timeout: 30000 })
      .closest('.cds--data-table-container')
      .find('tbody tr')
      .first()
      .should('contain', 'Dry run')
      .and('contain', 'Succeeded');
  });

  it('runs "Sync now", shows its counts, and opens its items with the type warnings', () => {
    cy.intercept('POST', '**/liberiaemr/mfl/runs').as('startRun');
    cy.visit(page);
    cy.contains('button', 'Sync now', { timeout: 30000 }).click();
    cy.wait('@startRun').then(({ request, response }) => {
      expect(request.body.dryRun ?? false).to.eq(false);
      expect(response?.statusCode).to.eq(202);
      waitForRun(response?.body.id).then((run) => {
        cy.reload();
        cy.contains('Run history', { timeout: 30000 })
          .closest('.cds--data-table-container')
          .find('tbody tr')
          .first()
          .should('contain', 'Sync')
          .and('contain', 'Succeeded')
          .and('contain', `${run.counts.unchanged} unchanged`)
          .within(() => cy.contains('button', 'View').click());
      });
    });
    cy.get('section[aria-label="Run detail"]', { timeout: 30000 }).within(() => {
      // The fixture puts two facilities in both Clinic and Health Center (ADR 0009 §3).
      cy.contains('Unchanged, with warnings').should('be.visible');
      cy.contains('Facility Type').should('be.visible');
    });
  });

  it('saves a new daily run time and turns the schedule on and off', () => {
    cy.intercept('PUT', '**/liberiaemr/mfl/config').as('saveConfig');
    cy.visit(page);
    cy.get('#mfl-time', { timeout: 30000 }).clear().type('04:15');
    cy.contains('button', 'Save settings').click();
    cy.wait('@saveConfig').then(({ request, response }) => {
      expect(request.body.schedule.time).to.eq('04:15');
      expect(request.body).not.to.have.property('username');
      expect(request.body).not.to.have.property('password');
      expect(response?.statusCode).to.eq(200);
    });
    cy.contains('Settings saved').should('be.visible');
    cy.reload();
    cy.get('#mfl-time', { timeout: 30000 }).should('have.value', '04:15');
    mflApi('PUT', '/config', { schedule: { time: '02:00' }, enabled: false });
  });

  it('shows the 400 when the MFL address is not on the allowlist, and keeps the old address', () => {
    cy.intercept('PUT', '**/liberiaemr/mfl/config').as('saveConfig');
    cy.visit(page);
    cy.get('#mfl-url', { timeout: 30000 }).clear().type('https://mfl.example.org/mfl');
    cy.contains('button', 'Save settings').click();
    cy.wait('@saveConfig').its('response.statusCode').should('eq', 400);
    cy.get(errorNotification, { timeout: 30000 }).should('be.visible');
    stubInternalUrl().then((url) => {
      mflApi('GET', '/status').its('body.config.url').should('eq', url);
    });
  });
});
