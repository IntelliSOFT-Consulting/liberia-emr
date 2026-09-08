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

    it('should add registered patient to the queue via the home page search', () => {
        const patientName = registerNewPatient();

        queuePage.visitHomePage();
        queuePage.searchAndSelectPatient(patientName);
        queuePage.startVisitFromSearch();
        queuePage.openQueueFormForPatient(patientName);
        queuePage.addPatientToServiceQueue('TB Screening');
        queuePage.verifyPatientInQueue(patientName, 'TB Screening');
    })
})
