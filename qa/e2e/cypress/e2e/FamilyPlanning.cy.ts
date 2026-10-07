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
});
