import { loginWithSession } from '../support/session';
import { mflLocation, syncFixture } from '../support/mfl';

// The central facility switcher (LE-324, PR from feat/LE-324-central-facility-switcher,
// ADR 0009 §6). Central sets the login app's chooseLocation.locationTag to "Health Facility".
// CI runs a facility stack, so these specs apply that one setting as an O3 temporary config,
// which the framework reads from localStorage. Without it the picker must behave exactly as it
// does at a facility today.
const LOGIN_APP = '@liberiaemr/esm-liberia-login-app';
const centralConfig = { [LOGIN_APP]: { chooseLocation: { locationTag: 'Health Facility' } } };

const openPicker = (asCentral: boolean) =>
  cy.visit('/openmrs/spa/login/location?update=true', {
    onBeforeLoad(win) {
      if (asCentral) {
        win.localStorage.setItem('openmrs:temporaryConfig', JSON.stringify(centralConfig));
      } else {
        win.localStorage.removeItem('openmrs:temporaryConfig');
      }
    },
  });

const search = (text: string) =>
  cy.get('input[role="searchbox"], input[type="search"]', { timeout: 30000 }).first().clear().type(text);

const facility = (uuid: string) => cy.get(`input[type="radio"][value="${uuid}"]`, { timeout: 30000 });

describe('Central facility switcher over the MFL', () => {
  before(() => {
    syncFixture();
  });

  beforeEach(() => {
    loginWithSession();
  });

  it('finds an MFL facility by name and shows its district and MFL code', () => {
    openPicker(true);
    cy.contains('Search by facility name or MFL code', { timeout: 30000 });
    search('Kesselee');
    facility(mflLocation.kesselee)
      .closest('.cds--radio-button-wrapper')
      .should('contain', 'Kesselee Memorial Health Center')
      .and('contain', 'Careysburg District')
      .and('contain', 'LBR-30-3002-02');
  });

  it('finds a facility by its MFL code', () => {
    openPicker(true);
    search('LBR-06-0624-06');
    facility(mflLocation.jahClinic).closest('.cds--radio-button-wrapper').should('contain', 'Jah Clinic');
    cy.get('input[type="radio"]').should('have.length', 1);
  });

  it('tells apart facilities that share a name', () => {
    openPicker(true);
    search('Fredai');
    cy.contains('Fredai Medical Clinic (Careysburg District)', { timeout: 30000 }).should('be.visible');
    cy.contains('FREDAI Medical Clinic (Somalia Drive District)').should('be.visible');
  });

  it('lists only the active facility when a closed one shares its name', () => {
    openPicker(true);
    search('Jamaica');
    facility(mflLocation.jamaicaActive).should('exist');
    cy.get('input[type="radio"]').should('have.length', 1);
  });

  it('switches the session to the chosen facility', () => {
    openPicker(true);
    search('Jah Clinic');
    facility(mflLocation.jahClinic).check({ force: true });
    cy.contains('button', 'Confirm').should('be.enabled').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login/location');
    cy.request('/openmrs/ws/rest/v1/session?v=custom:(sessionLocation:(uuid))')
      .its('body.sessionLocation.uuid')
      .should('eq', mflLocation.jahClinic);
  });

  it('leaves the facility picker unchanged where the central setting is absent', () => {
    openPicker(false);
    cy.get('input[name="loginLocations"]', { timeout: 30000 }).should('have.length.greaterThan', 0);
    cy.contains('Search by facility name or MFL code').should('not.exist');
    facility(mflLocation.kesselee).should('not.exist');
  });
});
