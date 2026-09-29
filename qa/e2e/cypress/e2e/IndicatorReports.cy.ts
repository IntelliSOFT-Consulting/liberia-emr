import { loginWithSession } from '../support/session';

/**
 * Indicator report runner (LE-335), @liberiaemr/esm-liberia-reports-app.
 *
 * The app lists only the reports in `reportUuids` that the server has registered, and selects
 * the first (RMNCAH). The run test picks the EMR-Ops report by name instead: its data set reads
 * the encounters every demo stack has, so the run shows figures whatever the sheet order.
 */
describe('Indicator reports', () => {
  beforeEach(() => {
    loginWithSession();
  });

  it('shows the Indicator reports menu entry to a user with Export National Report', () => {
    cy.visit('/openmrs/spa/home');
    cy.get('[aria-label="App Menu"], [aria-label="Open menu"]').first().click();
    cy.contains('a', 'Indicator reports').should('be.visible');
  });

  it('fixes the location to this facility and shows when report data was refreshed', () => {
    cy.visit('/openmrs/spa/indicator-reports');
    cy.contains('h3', 'Indicator reports').should('be.visible');
    cy.get('[data-testid="fixed-location"]').should('be.visible');
    cy.contains('Report data').should('be.visible');
    cy.contains('Central figures lag the facilities').should('not.exist');
  });

  it('runs a report, shows figures by disaggregation and downloads the CSV', () => {
    cy.intercept('POST', '**/reportingrest/reportRequest').as('requestReport');
    cy.intercept('GET', '**/reportingrest/reportDataSet/**').as('preview');

    cy.visit('/openmrs/spa/indicator-reports');
    cy.get('#liberia-report').select('MOH EMR Operational Indicators');
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
