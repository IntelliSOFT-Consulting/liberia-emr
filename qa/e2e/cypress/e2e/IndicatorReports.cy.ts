import { loginWithSession } from '../support/session';

/**
 * Indicator report runner (LE-335), @liberiaemr/esm-liberia-reports-app.
 *
 * PENDING: every test is `it.skip` until the liberiaemrreports module registers at least one
 * MOH report listed in `reportUuids` on the CI demo stack (docs/reporting/README.md 3.1). The
 * context endpoint, the ESM pin in distribution/distro.properties and `reportUuids` in
 * config-national.json are already in place. Until then Cypress reports these as pending and
 * the e2e job stays green: read the `N passing, M pending` tail. Unskip them in the PR that
 * registers the first report (qa/e2e/README.md).
 */
describe('Indicator reports', () => {
  beforeEach(() => {
    loginWithSession();
  });

  it.skip('shows the Indicator reports menu entry to a user with Export National Report', () => {
    cy.visit('/openmrs/spa/home');
    cy.get('[aria-label="App Menu"], [aria-label="Open menu"]').first().click();
    cy.contains('a', 'Indicator reports').should('be.visible');
  });

  it.skip('fixes the location to this facility and shows when report data was refreshed', () => {
    cy.visit('/openmrs/spa/indicator-reports');
    cy.contains('h3', 'Indicator reports').should('be.visible');
    cy.get('[data-testid="fixed-location"]').should('be.visible');
    cy.contains('Report data').should('be.visible');
    cy.contains('Central figures lag the facilities').should('not.exist');
  });

  it.skip('runs a report, shows figures by disaggregation and downloads the CSV', () => {
    cy.intercept('POST', '**/reportingrest/reportRequest').as('requestReport');
    cy.intercept('GET', '**/reportingrest/reportDataSet/**').as('preview');

    cy.visit('/openmrs/spa/indicator-reports');
    cy.contains('button', 'Run report').click();

    cy.wait('@requestReport').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get('[data-testid="run-status"]', { timeout: 120000 }).should('contain.text', 'Completed');
    cy.wait('@preview');
    cy.contains('th', 'Disaggregation').should('be.visible');

    cy.intercept('GET', '**/reportingrest/downloadReport*').as('download');
    cy.contains('button', 'Download CSV').click();
    cy.wait('@download').its('response.body.filename').should('match', /\.csv$/);
  });
});
