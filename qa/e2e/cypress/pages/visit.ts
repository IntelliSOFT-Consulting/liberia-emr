import RegistrationPage from './Registration';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';

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
            birthdate: randomAdultBirthdateParts(),
            phoneNumber: liberiaPhoneNumber()
        });
        this.registrationPage.clickRegisterPatient();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');

        // The chart shell (including the Actions menu) can take a moment to mount after navigation
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
        cy.contains('button', 'Actions', { timeout: 30000 }).should('be.visible');
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

        cy.get(`#payment-details-${paymentDetails}`, { timeout: 20000 }).scrollIntoView().should('exist').check({ force: true });

        // The queue location field renders further down the form and can be scrolled out of view
        cy.get('#queueLocation', { timeout: 20000 }).scrollIntoView().should('be.visible');

        cy.contains('button', 'Start visit', { timeout: 20000 })
            .scrollIntoView()
            .should('be.enabled')
            .click({ force: true });

        cy.contains('.cds--tag__label', 'Active Visit', { timeout: 20000 }).should('be.visible');
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