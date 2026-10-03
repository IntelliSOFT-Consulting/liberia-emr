import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import ANCInitialFormPage from '../pages/ancInitialForm';

describe('Initial ANC Assessment form', () => {
    const registrationPage = new RegistrationPage();
    const visitPage = new VisitPage();
    const ancInitialForm = new ANCInitialFormPage();

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
        ancInitialForm.openClinicalForms();
        ancInitialForm.selectForm();
    });

    it('opens for a registered female patient aged 16 to 35', () => {
        ancInitialForm.verifyFormContract();
    });

    it('blocks saving when required ANC assessment fields are empty', () => {
        ancInitialForm.verifyRequiredFieldsBlockSave();
    });

    it('validates consistency across obstetric history fields', () => {
        ancInitialForm.verifyObstetricHistoryConsistency();
    });
});