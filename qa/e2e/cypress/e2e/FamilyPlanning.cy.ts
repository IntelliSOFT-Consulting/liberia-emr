import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import FamilyPlanningFormPage from '../pages/familyPlanningForm';

describe('Family Planning form', () => {
    const registrationPage = new RegistrationPage();
    const visitPage = new VisitPage();
    const familyPlanningForm = new FamilyPlanningFormPage();

    beforeEach(() => {
        loginWithSession();
        registrationPage.visitPage();
        registrationPage.fillRequiredFields({
            firstName: faker.person.firstName(),
            familyName: faker.person.lastName(),
            sex: 'female',
            birthdate: randomAdultBirthdateParts(16, 35),
            phoneNumber: liberiaPhoneNumber()
        });
        registrationPage.clickRegisterPatient();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
        visitPage.startVisit();
        familyPlanningForm.openClinicalForms();
        familyPlanningForm.selectForm();
    });

    it('validates the initial Family Planning form contract');

    it('FP-02: blocks saving for each independently missing required answer', () => {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');

        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.selectPurposeForCommodities();
        familyPlanningForm.verifyRequiredFieldBlocksSave('familyPlanningClientType');

        familyPlanningForm.reopenForm();
        familyPlanningForm.selectClientType('New Family Planning Client');
        cy.get('input[id^="purposeOfVisit-"]').should('not.exist');
        familyPlanningForm.verifyRequiredFieldBlocksSave('counsellingDone');

        familyPlanningForm.reopenForm();
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyEmptyPurposeOfVisitBlocksSave();
    });
});
