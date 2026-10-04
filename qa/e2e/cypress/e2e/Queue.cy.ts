import { loginWithSession } from '../support/session';
import { ERROR_NOTIFICATION } from '../support/landing';
import { type Auth, createUser, loginAs, runPassword } from '../support/users';
import RegistrationPage from '../pages/Registration';
import QueuePage from '../pages/queue';
import VisitPage from '../pages/visit';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';

/**
 * Checking a patient in to the service queue from the home page.
 *
 * Until LE-395 this was skipped: on the demo stack every queue-entry search answered 500
 * ("Unable to find concept"), because the queue status and priority concepts never loaded (the
 * RefApp demo queue dictionary already held their names). The second test does the same as the
 * Records Officer alone, who registers and checks in patients at a facility. The third has the
 * officer end that visit too: until LE-396 that answered 403 "Assign Beds" for every role but the
 * administrator, because the bed management module demanded bed write privileges on ending any
 * visit, bed or no bed (packages/modify-pr/.patches/0005-*).
 */
describe('Queue', () => {
    const registrationPage = new RegistrationPage();
    const queuePage = new QueuePage();
    const visitPage = new VisitPage();
    // A throwaway account on the disposable demo stack, with a password generated per run.
    const officer: Auth = { username: `e2e-queue-officer-${Date.now()}`, password: runPassword('Queue') };

    const registerNewPatient = (): string => {
        const firstName = faker.person.firstName();
        const familyName = faker.person.lastName();

        registrationPage.visitPage();
        registrationPage.fillRequiredFields({
            firstName,
            familyName,
            sex: faker.helpers.arrayElement(['male', 'female'] as const),
            birthdate: randomAdultBirthdateParts(),
            phoneNumber: liberiaPhoneNumber()
        });
        registrationPage.clickRegisterPatient();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');

        return `${firstName} ${familyName}`;
    };

    /** The chart URL registration lands on, as the patient's UUID. */
    const currentPatientUuid = () =>
        cy.url().then((url) => {
            const uuid = url.match(/\/patient\/([0-9a-f-]{36})\//)?.[1];
            expect(uuid, 'patient UUID in the chart URL').to.exist;
            return uuid as string;
        });

    before(() => {
        createUser(officer, ['Records Officer']);
    });

    beforeEach(() => {
        loginWithSession();
    });

    it('should add registered patient to the queue via the home page search', () => {
        const patientName = registerNewPatient();

        queuePage.visitHomePage();
        queuePage.searchAndSelectPatient(patientName);
        queuePage.startVisitFromSearch();
        queuePage.verifyPatientInQueue(patientName, 'TB Screening');
    })

    it('lets a Records Officer see the queue and add a patient to it', () => {
        // Registered as the admin: what is under test is the officer's queue, not registration.
        const patientName = registerNewPatient();

        loginAs(officer, 'queue');
        queuePage.visitHomePage();
        cy.location('pathname', { timeout: 30000 }).should('eq', '/openmrs/spa/home/service-queues');
        cy.contains(/patients currently in queue/i, { timeout: 30000 }).should('be.visible');
        queuePage.searchAndSelectPatient(patientName);
        // The officer holds no billing privilege, so the billing app's payment fields are not shown.
        queuePage.startVisitFromSearch('Outpatient', null);
        queuePage.verifyPatientInQueue(patientName, 'TB Screening');
        cy.get(ERROR_NOTIFICATION).should('not.exist');
    })

    it('lets a Records Officer check a patient in, queue them and end the visit', () => {
        // Registered as the admin, as above.
        const patientName = registerNewPatient();

        currentPatientUuid().then((patientUuid) => {
            loginAs(officer, 'queue');
            queuePage.visitHomePage();
            queuePage.searchAndSelectPatient(patientName);
            queuePage.startVisitFromSearch('Outpatient', null);
            queuePage.verifyPatientInQueue(patientName, 'TB Screening');

            // Ending the visit is a POST of its stop time to /visit/{uuid}. Intercepted only now,
            // so the check-in's own calls cannot match.
            cy.intercept('POST', '**/ws/rest/v1/visit/*').as('endVisit');
            cy.visit(`/openmrs/spa/patient/${patientUuid}/chart/Patient Summary`);
            visitPage.verifyVisitActive();
            visitPage.endVisit();

            cy.wait('@endVisit', { timeout: 30000 }).then(({ request, response }) => {
                expect(request.body, 'the end-visit call').to.have.property('stopDatetime');
                expect(response?.statusCode, `end visit answered ${JSON.stringify(response?.body)}`).to.eq(200);
            });
            cy.contains('Visit ended', { timeout: 20000 }).should('be.visible');
            cy.contains('Error ending visit').should('not.exist');
            visitPage.verifyVisitNotActive();
        });
    })
})
