import VisitPage from '../pages/visit';
import {
  BENSONVILLE,
  refreshAnswer,
  REMOTE_IMPORT_APPS,
  stubCentral,
  stubLocalHistory,
  twoFacilityHistory,
  type LocalHistory,
} from '../support/external-records';
import { loadLocalEsms } from '../support/local-esm';
import { loginWithSession } from '../support/session';
import { type Auth, createUser, loginAs as loginAsUser, runPassword } from '../support/users';

/**
 * Remote import (LE-387) and External records (LE-386), at a facility:
 *  - a Records Officer finds a patient held at central, gives a reason and imports them;
 *  - a Clinician, who may not import, is told to ask a Records Officer;
 *  - a Clinician reads the imported patient's records from other facilities: banner tag, summary
 *    card, dashboard with its facility filter, every status (6a–6f), and Refresh.
 *
 * The CI stack has no central, so the facility endpoints that ask central are stubbed
 * (support/external-records.ts). The imported patient is a real one registered here, so the chart
 * is the real chart. Until distro.properties pins builds of both apps with this behaviour,
 * loadLocalEsms() serves this checkout's builds (support/local-esm.ts); CI builds them first.
 */

// Throwaway accounts on a disposable demo stack, with a password generated per run.
const run = `${Date.now()}`;
const password = runPassword('Remote');
const officer: Auth = { username: `e2e-records-officer-${run}`, password };
const clinician: Auth = { username: `e2e-clinician-${run}`, password };
const familyName = `Kollie${run.slice(-5)}`;

const loginAs = (user: Auth) => loginAsUser(user, 'external-records');
const now = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const DASHBOARD = '[data-extension-id="liberia-external-records-dashboard"]';
const SUMMARY = '[data-extension-id="liberia-external-records-summary"]';

const searchCentral = () => {
  cy.visit(`/openmrs/spa/search?query=${familyName}`);
  // Carbon draws the switch's track over its button.
  cy.get('#liberia-remote-search-toggle', { timeout: 60000 }).click({ force: true });
  cy.get('#liberia-remote-search-toggle').should('have.attr', 'aria-checked', 'true');
  cy.wait('@remoteSearch');
};

describe('Remote import and External records', () => {
  let patientUuid: string;

  before(() => {
    loginWithSession();
    new VisitPage().registerPatient();
    cy.location('pathname').then((path) => {
      patientUuid = path.match(/patient\/([0-9a-f-]{36})/)?.[1] ?? '';
      expect(patientUuid, 'registered patient').to.have.length(36);
    });
    createUser(officer, ['Records Officer']);
    createUser(clinician, ['Clinician']);
  });

  describe('Import', () => {
    beforeEach(() => {
      stubCentral(familyName);
    });

    it('lets a Records Officer import with a reason, showing progress, and opens the chart', () => {
      loginAs(officer);
      loadLocalEsms(REMOTE_IMPORT_APPS);
      cy.intercept('POST', '**/ws/rest/v1/liberiaemr/importpatient', {
        delay: 1000,
        body: { localUuid: patientUuid, created: true, history: 'deferred' },
      }).as('importPatient');
      cy.intercept('POST', `**/ws/rest/v1/liberiaemr/remotehistory/local/${patientUuid}/refresh`, {
        delay: 1000,
        body: refreshAnswer(true, now()),
      }).as('refreshHistory');

      searchCentral();
      cy.contains('button', 'Import & Open', { timeout: 30000 }).click();

      // ADR 0007: the reason comes first, and Cancel sends nothing.
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Why are you opening this record?').should('be.visible');
        cy.contains('button', 'Import & Open').should('be.disabled');
        cy.contains('button', 'Cancel').click();
      });
      cy.contains('Why are you opening this record?').should('not.exist');
      cy.get('@importPatient.all').should('have.length', 0);

      cy.contains('button', 'Import & Open').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('label', 'Referral in').click();
        cy.contains('button', 'Import & Open').should('be.enabled').click();
      });

      // The progress dialog takes focus from the gone button and reports each step.
      cy.contains('IMPORTING RECORD').should('be.visible');
      cy.focused().should('have.attr', 'aria-busy', 'true');
      cy.get('[role="progressbar"][aria-label="Import progress"]')
        .should('have.attr', 'aria-valuenow')
        .and('not.eq', '0');

      cy.wait('@importPatient')
        .its('request.body')
        .should('deep.equal', { remoteUuid: 'e2e-remote-patient', reason: 'Referral in', deferHistory: true });
      cy.wait('@refreshHistory').its('request.body').should('deep.equal', { reason: 'Referral in' });

      cy.url({ timeout: 30000 }).should('include', `/patient/${patientUuid}/chart`);
      cy.contains('Patient imported successfully', { timeout: 30000 }).should('be.visible');
      cy.contains('Records from 2 other facilities are in External records.').should('be.visible');
    });

    it('tells a Clinician without the import privilege to ask a Records Officer', () => {
      loginAs(clinician);
      loadLocalEsms(REMOTE_IMPORT_APPS);

      searchCentral();
      cy.contains(`Musu ${familyName}`, { timeout: 30000 }).should('be.visible');
      cy.contains('Ask a Records Officer to import this patient.').should('be.visible');
      cy.contains('button', 'Import & Open').should('not.exist');
    });
  });

  describe('External records', () => {
    const openChart = (history: LocalHistory, page = '') => {
      loginAs(clinician);
      loadLocalEsms(REMOTE_IMPORT_APPS);
      stubLocalHistory(patientUuid, history);
      cy.visit(`/openmrs/spa/patient/${patientUuid}/chart${page}`);
      cy.wait('@localHistory');
    };
    const fresh = (): LocalHistory => ({ status: 'fresh', fetchedAt: now(), sources: twoFacilityHistory() });

    it('shows the banner tag, the summary card and a read-only dashboard a Clinician can filter', () => {
      openChart(fresh());

      cy.contains('a', 'Records from other facilities (2)', { timeout: 30000 }).should('be.visible');
      cy.get(SUMMARY, { timeout: 30000 }).within(() => {
        cy.contains('External records').should('be.visible');
        cy.contains('As of').should('be.visible');
        // Screen readers hear what the tags mean, not only EXTERNAL.
        cy.contains('.cds--tag', 'EXTERNAL').should('contain.text', 'Recorded at another facility');
        cy.contains('button', 'View All External Records').click();
      });

      cy.url().should('include', `/patient/${patientUuid}/chart/external-records`);
      cy.get(DASHBOARD, { timeout: 30000 }).within(() => {
        cy.contains('h2', 'External records').should('be.visible');
        cy.contains('External · Read-only').should('be.visible');
        cy.contains('Penicillin').should('be.visible');
        cy.contains('Hypertension').should('be.visible');
        cy.contains('Ferrous sulphate 200mg').should('be.visible');
        cy.contains('Tetanus toxoid').should('be.visible');
        cy.contains('ANC Danger Sign: High systolic BP').should('be.visible');
        cy.contains('20 weeks').should('be.visible');
        cy.contains('Contact the facility for details').should('be.visible');
        // Read-only: Refresh is the only action.
        cy.get('button').each(($button) => expect($button.text()).not.to.match(/^(edit|delete|add)/i));

        cy.get('#external-records-facility').click();
        cy.contains('[role="option"]', BENSONVILLE.name).click();
        cy.contains('Ferrous sulphate 200mg').should('be.visible');
        cy.contains('Penicillin').should('not.exist');
        cy.contains(`No allergies recorded at ${BENSONVILLE.name}`).should('be.visible');
      });
      cy.contains('nav a, [role="navigation"] a', 'External records').should('exist');
    });

    it('keeps the status bar a status line: it does not take focus or close on Escape', () => {
      openChart(fresh(), '/external-records');

      cy.get(DASHBOARD, { timeout: 30000 }).find('.cds--actionable-notification').as('bar');
      cy.get('@bar').should('have.attr', 'role', 'status');
      cy.document()
        .its('activeElement')
        .should('not.have.class', 'cds--actionable-notification__action-button');
      cy.get('body').type('{esc}');
      cy.get('@bar').should('be.visible').and('contain.text', 'Refresh');
    });

    const states: Array<{ name: string; history: LocalHistory; title: string; action: string }> = [
      {
        name: 'stale',
        history: { status: 'stale', fetchedAt: daysAgo(3), sources: twoFacilityHistory() },
        title: 'Could not refresh from central',
        action: 'Retry Refresh',
      },
      {
        name: 'offline',
        history: { status: 'offline', fetchedAt: daysAgo(3), sources: twoFacilityHistory() },
        title: 'Offline',
        action: 'Retry',
      },
      {
        name: 'not retrieved',
        history: { status: 'notRetrieved', fetchedAt: null, sources: [] },
        title: 'History not yet retrieved',
        action: 'Retry',
      },
      {
        name: 'no remote history',
        history: { status: 'fresh', fetchedAt: now(), sources: [] },
        title: 'No records from other facilities',
        action: 'Retry',
      },
    ];

    states.forEach(({ name, history, title, action }) => {
      it(`shows the ${name} state`, () => {
        openChart(history, '/external-records');

        cy.get(DASHBOARD, { timeout: 30000 }).within(() => {
          cy.contains(title).should('be.visible');
          cy.contains('button', action).should('be.visible');
        });
        // The banner tag counts facilities; with none it is hidden (6f).
        if (!history.sources.length) {
          cy.contains('Records from other facilities').should('not.exist');
        }
      });
    });

    it("goes unavailable offline when this facility's server stops answering before any copy", () => {
      openChart({ status: 'notRetrieved', fetchedAt: null, sources: [] }, '/external-records');
      cy.get(DASHBOARD, { timeout: 30000 }).contains('History not yet retrieved').should('be.visible');

      const local = `**/ws/rest/v1/liberiaemr/remotehistory/local/${patientUuid}`;
      cy.intercept('POST', `${local}/refresh`, { forceNetworkError: true });
      cy.intercept('GET', local, { forceNetworkError: true });
      cy.get(DASHBOARD).contains('button', 'Retry').click();

      cy.get(DASHBOARD)
        .contains('History from other facilities unavailable offline', { timeout: 30000 })
        .should('be.visible');
    });

    it('refreshes from central, and says so when central cannot be reached', () => {
      const shownAt = daysAgo(3);
      openChart({ status: 'stale', fetchedAt: shownAt, sources: twoFacilityHistory() }, '/external-records');
      const refreshUrl = `**/ws/rest/v1/liberiaemr/remotehistory/local/${patientUuid}/refresh`;

      cy.intercept('POST', refreshUrl, { body: refreshAnswer(true, now()) }).as('refreshOk');
      cy.get(DASHBOARD, { timeout: 30000 }).contains('button', 'Retry Refresh').click();
      cy.wait('@refreshOk');
      cy.contains('External records refreshed', { timeout: 30000 }).should('be.visible');

      cy.intercept('POST', refreshUrl, { body: refreshAnswer(false, shownAt) }).as('refreshFailed');
      cy.get(DASHBOARD).contains('button', 'Retry Refresh').click();
      cy.wait('@refreshFailed');
      // Only the snackbar says "Still"; the stale bar under it keeps its own wording.
      cy.contains('Still showing records as of', { timeout: 30000 }).should('be.visible');
    });
  });
});
