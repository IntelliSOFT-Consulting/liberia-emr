import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import PartographPage from '../pages/partograph';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const partographPage = new PartographPage();

const registerFemalePatientWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName('female'),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(18, 40),
        phoneNumber: liberiaPhoneNumber(),
    });
    registrationPage.clickRegisterPatient();
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
};

describe('Partograph prerequisites', { retries: 1 }, () => {
    beforeEach(() => {
        loginWithSession();
    });

    it('requires a Labour Admission encounter before showing Partograph monitoring', () => {
        registerFemalePatientWithVisit();
        partographPage.openDashboard();
        partographPage.verifyAdmissionRequired();
    });
});
