import { loginWithSession } from '../support/session';
import RegistrationPage from '../pages/Registration';
import QueuePage from '../pages/queue';
import { faker, randomAdultBirthdateParts } from '../support/faker';

describe('Queue', () => {
    const registrationPage = new RegistrationPage();
    const queuePage = new QueuePage();

    const registerNewPatient = (): string => {
        const firstName = faker.person.firstName();
        const familyName = faker.person.lastName();

        registrationPage.visitPage();
        registrationPage.fillRequiredFields({
            firstName,
            familyName,
            sex: faker.helpers.arrayElement(['male', 'female'] as const),
            birthdate: randomAdultBirthdateParts()
        });
        registrationPage.clickRegisterPatient();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');

        return `${firstName} ${familyName}`;
    };

    beforeEach(() => {
        loginWithSession();
    });

    it.skip('should add registered patient to the queue via the home page search', () => {
        // Suspended: CI's --demo Careysburg content package has no queue services configured
        // (500 on GET /openmrs/ws/rest/v1/queue-entry, "No services configured" in the UI).
        // Re-enable once content-package seeding is fixed.
        const patientName = registerNewPatient();

        queuePage.visitHomePage();
        queuePage.searchAndSelectPatient(patientName);
        queuePage.startVisitFromSearch();
        queuePage.verifyPatientInQueue(patientName, 'TB Screening');
    })
})
