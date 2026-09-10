import AuthenticationPage from '../pages/AuthenticationPage';
import { loginWithSession } from '../support/session';
import Registration from '../pages/Registration';
import { faker, futureBirthdateParts, randomAdultBirthdateParts } from '../support/faker';

type RegistrationTestData = {
    firstName: string;
    familyName: string;
    sex: 'male' | 'female';
    birthdate: { day: string; month: string; year: string };
};

const createRegistrationTestData = (): RegistrationTestData => {
    return {
        firstName: faker.person.firstName(),
        familyName: faker.person.lastName(),
        sex: faker.helpers.arrayElement(['male', 'female'] as const),
        birthdate: randomAdultBirthdateParts()
    };
};

describe ('Authentication', () => {
    it('should load the login page', () => {
        const authPage = new AuthenticationPage();
        authPage.visitPage();
        authPage.verifyLoginPageLoaded();
    });

    it('should load the home page', () => {
        loginWithSession();
        cy.visit('/openmrs/spa/home');
    });
});

describe('Registration', () => {
    const registrationPage = new Registration();
    let testData: RegistrationTestData;

    const fillAndSubmitValidRegistration = () => {
        registrationPage.fillRequiredFields({
            firstName: testData.firstName,
            familyName: testData.familyName,
            sex: testData.sex,
            birthdate: testData.birthdate
        });
        registrationPage.clickRegisterPatient();
    };

    const verifyServerErrorMessage = (statusCode: 400 | 409 | 500, message: string) => {
        cy.intercept('POST', '**/ws/rest/v1/patient**', {
            statusCode,
            body: {
                message,
                error: { message }
            }
        }).as('createPatientError');

        fillAndSubmitValidRegistration();
        cy.wait('@createPatientError', { timeout: 10000 });

        cy.get('[role="alertdialog"]', { timeout: 10000 }).should('be.visible');
        cy.contains(new RegExp(`${message}|error|failed|unable|duplicate`, 'i'), { timeout: 10000 }).should('be.visible');
    };

    beforeEach(() => {
        loginWithSession();
        registrationPage.visitPage();
        testData = createRegistrationTestData();
    });

    it('should load the registration page', () => {
        registrationPage.verifyRegistrationPageLoaded();
    })

    it('should show required field errors when submitting empty registration form', () => {
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['First Name', 'Family Name', 'Sex', 'birthdate']);
    })

    it('should show only remaining required errors after filling first name', () => {
        registrationPage.fillRequiredFields({ firstName: testData.firstName });
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['Family Name', 'Sex', 'birthdate']);
    })

    it('should show only sex and birthdate errors after filling first and family names', () => {
        registrationPage.fillRequiredFields({
            firstName: testData.firstName,
            familyName: testData.familyName
        });
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['Sex', 'birthdate']);
    })

    it('should show only birthdate error after filling names and sex', () => {
        registrationPage.fillRequiredFields({
            firstName: testData.firstName,
            familyName: testData.familyName,
            sex: testData.sex
        });
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['birthdate']);
    })

    it('should successfully register a patient with valid data', () => {
        cy.intercept('POST', '**/ws/rest/v1/patient**', {
            statusCode: 201,
            body: { uuid: faker.string.uuid() }
        }).as('createPatient');

        fillAndSubmitValidRegistration();
        registrationPage.verifyNoRequiredFieldErrors();

        cy.wait('@createPatient', { timeout: 10000 }).then(({ request, response }) => {
            expect(request.method).to.equal('POST');
            expect(response?.statusCode).to.equal(201);
        });
    })

    it('should reject a future date of birth', () => {
        registrationPage.fillRequiredFields({
            firstName: testData.firstName,
            familyName: testData.familyName,
            sex: testData.sex,
            birthdate: futureBirthdateParts(2)
        });
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['birthdate']);
    })

    it('should show name fields and keep name validation when Patient Name is Known is Yes', () => {
        registrationPage.setPatientNameKnown('Yes');
        registrationPage.verifyNameFieldsVisible();
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['First Name', 'Family Name', 'Sex', 'birthdate']);
    })

    it('should hide name fields when Patient Name is Known is No', () => {
        registrationPage.setPatientNameKnown('No');
        registrationPage.verifyNameFieldsNotVisible();
        registrationPage.clickRegisterPatient();
        registrationPage.verifyRequiredFieldErrors(['Sex', 'birthdate']);
    })

    it('should show full date input path when Date of Birth Known is Yes', () => {
        registrationPage.setDateOfBirthKnown('Yes');
        registrationPage.verifyDobKnownYesFlow();
    })

    it('should show estimated age fields when Date of Birth Known is No', () => {
        registrationPage.setDateOfBirthKnown('No');
        registrationPage.verifyDobKnownNoFlow();
    })

    it('should submit registration payload with correct keys and values', () => {
        cy.intercept('POST', '**/ws/rest/v1/patient**', {
            statusCode: 201,
            body: { uuid: faker.string.uuid() }
        }).as('createPatient');

        fillAndSubmitValidRegistration();

        cy.wait('@createPatient', { timeout: 10000 }).then(({ request }) => {
            const body = request.body as {
                person?: { gender?: string; birthdate?: string; birthDate?: string; names?: Array<{ givenName?: string; familyName?: string }> };
            };

            expect(body).to.have.property('person');
            expect(body.person).to.have.property('gender');
            expect(body.person).to.have.any.keys('birthdate', 'birthDate');

            const payloadText = JSON.stringify(body);
            expect(payloadText).to.include(testData.firstName);
            expect(payloadText).to.include(testData.familyName);
            expect(payloadText).to.match(new RegExp(testData.birthdate.year));
        });
    })

    it('should display an error message when registration API returns 400', () => {
        verifyServerErrorMessage(400, 'Invalid patient payload');
    })

    it('should display an error message when registration API returns 409', () => {
        verifyServerErrorMessage(409, 'Duplicate patient record found');
    })

    it('should display an error message when registration API returns 500', () => {
        verifyServerErrorMessage(500, 'Server error while creating patient');
    })

    it('should prevent double submit on rapid clicks', () => {
        registrationPage.preventDoubleSubmitOnRapidClicks(testData);
    })

    it('should successfully register a patient with valid data against live backend', () => {
        fillAndSubmitValidRegistration();
        cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
        cy.contains('Vitals and biometrics', { timeout: 100000 }).should('be.visible');
    })

})