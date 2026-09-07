import RegistrationPage from './Registration';
import { faker, randomAdultBirthdateParts } from '../support/faker';

class VisitPage {
    private registrationPage = new RegistrationPage();

    private openActionsMenuItem(itemText: string) {
        cy.contains('button', 'Actions', { timeout: 20000 }).click();
        cy.contains(itemText, { timeout: 10000 }).click();
    }

    registerPatient() {
        this.registrationPage.visitPage();
        this.registrationPage.fillRequiredFields({
            firstName: faker.person.firstName(),
            familyName: faker.person.lastName(),
            sex: faker.helpers.arrayElement(['male', 'female'] as const),
            birthdate: randomAdultBirthdateParts()
        });
        this.registrationPage.clickRegisterPatient();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
        cy.contains('button', 'Actions', { timeout: 20000 }).should('be.visible');
    }

    startVisit(visitType?: string, paymentDetails: 'paying' | 'non-paying' = 'paying') {
        this.openActionsMenuItem('Add visit');

        cy.contains('Start a visit', { timeout: 20000 }).should('be.visible');

        cy.get('input[name="visit-types"]', { timeout: 20000 }).should('have.length.greaterThan', 0);

        if (visitType) { 
            cy.contains('.cds--radio-button-wrapper', visitType, { timeout: 20000 })
                .find('input[name="visit-types"]')
                .check({ force: true });
        } else {
            cy.get('input[name="visit-types"]', { timeout: 20000 }).first().check({ force: true });
        }

        cy.get(`#payment-details-${paymentDetails}`, { timeout: 20000 }).check({ force: true });
        cy.contains('button', 'Start visit', { timeout: 20000 }).should('be.enabled').click();
    }

    endVisit() {
        this.openActionsMenuItem('End active visit');

        cy.contains('Are you sure you want to end this active visit?', { timeout: 20000 }).should('be.visible');
        cy.contains('button', 'End Visit', { timeout: 10000 }).click();
    }

    verifyVisitActive() {
        cy.contains('.cds--tag__label', 'Active Visit', { timeout: 20000 }).should('be.visible');
    }

    verifyVisitNotActive() {
        cy.contains('.cds--tag__label', 'Active Visit', { timeout: 20000 }).should('not.exist');
    }
}

export default VisitPage;