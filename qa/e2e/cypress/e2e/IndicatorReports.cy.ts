import { loginWithSession } from '../support/session';

/**
 * Indicator report runner (LE-335), @liberiaemr/esm-liberia-reports-app.
 *
 * The app lists only the reports in `reportUuids` that the server has registered, and selects
 * the first (RMNCAH). The run test picks the EMR-Ops report by name instead: its data set reads
 * the encounters every demo stack has, so the run shows figures whatever the sheet order.
 *
 * The per-sheet tests (LE-336) run and export each of the five MOH sheets, chosen by name, the
 * way a reporting officer would. They check that every sheet runs to Completed on this stack and
 * that its CSV reaches the browser as a file. The figures themselves are compared with the
 * hand-counted expected values by qa/reporting/compare-reports.py, on a stack with the
 * synthetic fixtures loaded; the demo stack's data is not counted by hand, so no figure is
 * asserted here.
 */
const SHEETS = [
  'MOH RMNCAH Indicators',
  'MOH Nutrition Indicators',
  'MOH Malaria Indicators',
  'MOH NCD Indicators',
  'MOH EMR Operational Indicators',
];

/** reportingrest's ReportFile.fileContent as text: base64 (Jackson's byte[]), a byte array, or plain text. */
const csvText = (content: unknown): string => {
  if (Array.isArray(content)) {
    return String.fromCharCode(...content.map((b: number) => b & 0xff));
  }
  if (typeof content !== 'string') {
    return '';
  }
  return /^[A-Za-z0-9+/\r\n]*={0,2}\s*$/.test(content) ? atob(content.replace(/\s+/g, '')) : content;
};

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

  it('offers all five MOH sheets', () => {
    cy.visit('/openmrs/spa/indicator-reports');
    cy.get('#liberia-report option').then((options) => {
      const names = [...options].map((o) => o.textContent?.trim());
      SHEETS.forEach((sheet) => expect(names, 'reports offered').to.include(sheet));
    });
  });

  SHEETS.forEach((sheet) => {
    it(`runs and exports ${sheet} as CSV`, () => {
      cy.intercept('POST', '**/reportingrest/reportRequest').as('requestReport');

      cy.visit('/openmrs/spa/indicator-reports');
      cy.get('#liberia-report').select(sheet);
      cy.get('#liberia-report option:selected').should('have.text', sheet);
      cy.contains('button', 'Run report').click();

      // The request must be for the sheet chosen, and run with its CSV design.
      cy.wait('@requestReport').then(({ request, response }) => {
        expect(response?.statusCode, 'reportRequest').to.be.oneOf([200, 201]);
        cy.get('#liberia-report')
          .invoke('val')
          .then((reportUuid) => {
            expect(request.body?.reportDefinition?.parameterizable?.uuid, 'report requested').to.eq(reportUuid);
          });
      });
      cy.get('[data-testid="run-status"]', { timeout: 120000 }).should('contain.text', 'Completed');

      cy.intercept('GET', '**/reportingrest/downloadReport*').as('download');
      cy.contains('button', 'Download CSV').should('be.enabled').click();
      cy.wait('@download').then(({ response }) => {
        expect(response?.statusCode, 'downloadReport').to.eq(200);
        const file = response?.body as { filename?: string; contentType?: string; fileContent?: unknown };
        expect(file.filename, 'file name').to.match(/\.csv$/);
        // The file the app hands to the browser, decoded the way report-file.ts decodes it. A CSV
        // has a header row of columns, so it holds a comma whichever encoding the server used.
        expect(csvText(file.fileContent), 'CSV content').to.contain(',');
      });
      cy.contains('The export could not be produced').should('not.exist');
    });
  });
});
