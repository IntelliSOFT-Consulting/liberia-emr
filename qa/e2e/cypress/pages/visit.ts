import RegistrationPage from './Registration';
import { faker, randomAdultBirthdateParts } from '../support/faker';

class VisitPage {
    private registrationPage = new RegistrationPage();

    // Minimal setup so a visit test has a patient to work with — not itself a registration test.
    registerPatient() {
        this.registrationPage.visitPage();
        this.registrationPage.fillRequiredFields({
            firstName: faker.person.firstName(),
            familyName: faker.person.lastName(),
            sex: faker.helpers.arrayElement(['male', 'female'] as const),
            birthdate: randomAdultBirthdateParts()
        });
        this.registrationPage.clickRegisterPatient();
    }

    startVisit(visitType?: string, paymentDetails: 'paying' | 'non-paying' = 'paying') {
        cy.contains('button', 'Actions', { timeout: 20000 }).click();
        cy.contains('Add visit', { timeout: 10000 }).click();

        cy.contains('Start a visit', { timeout: 20000 }).should('be.visible');

        cy.contains('.cds--content-switcher-btn', 'All', { timeout: 20000 }).click();
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

    verifyVisitActive() {
        cy.contains('.cds--tag__label', 'Active Visit', { timeout: 20000 }).should('be.visible');
    }
}

export default VisitPage;
