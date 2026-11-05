import RegistrationPage from '../pages/Registration';
import { enrolInAnc } from '../support/anc-enrolment';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import { loginWithSession } from '../support/session';

describe('Shared ANC enrolment helper', () => {
    let patientUuid: string | undefined;
    let enrolmentUuid: string | undefined;

    beforeEach(() => {
        patientUuid = undefined;
        enrolmentUuid = undefined;
        loginWithSession();
        const registration = new RegistrationPage();
        registration.visitPage();
        registration.fillRequiredFields({
            firstName: faker.person.firstName(),
            familyName: faker.person.lastName(),
            sex: 'female',
            birthdate: randomAdultBirthdateParts(16, 35),
            phoneNumber: liberiaPhoneNumber(),
        });
        cy.intercept('POST', '**/ws/rest/v1/patient').as('registerAncPatient');
        registration.clickRegisterPatient();
        cy.wait('@registerAncPatient').then(({ response }) => {
            expect(response?.statusCode, 'synthetic patient registration').to.equal(201);
            const uuid: string = response?.body.uuid;
            expect(uuid, 'synthetic patient UUID').to.be.a('string').and.not.be.empty;
            patientUuid = uuid;
        });
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    });

    afterEach(() => {
        if (enrolmentUuid) {
            cy.request('DELETE', `/openmrs/ws/rest/v1/programenrollment/${enrolmentUuid}?reason=ANC-helper-test-cleanup`);
        }
        if (patientUuid) {
            cy.request('DELETE', `/openmrs/ws/rest/v1/patient/${patientUuid}?reason=ANC-helper-test-cleanup`);
        }
    });

    it('creates and reads back an enrolment dated now without starting a visit or opening a form', () => {
        cy.then(() => {
            if (!patientUuid) throw new Error('Synthetic patient was not registered');
            const before = Date.now();
            return enrolInAnc(patientUuid).then((saved) => {
                enrolmentUuid = saved.uuid;
                expect(new Date(saved.dateEnrolled).getTime()).to.be.within(before - 1000, Date.now());
            });
        });
    });

    it('preserves an explicit historical enrolment date', () => {
        cy.then(() => {
            if (!patientUuid) throw new Error('Synthetic patient was not registered');
            return enrolInAnc(patientUuid, new Date('2026-01-15T00:00:00.000Z')).then((saved) => {
                enrolmentUuid = saved.uuid;
                expect(new Date(saved.dateEnrolled).toISOString()).to.equal('2026-01-15T00:00:00.000Z');
            });
        });
    });
});
