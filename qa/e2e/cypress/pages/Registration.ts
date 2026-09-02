class RegistrationPage {
    private readonly requiredErrorFields = ['First Name', 'Family Name', 'Sex', 'birthdate'];

    visitPage() {
        cy.visit('/openmrs/spa/patient-registration');
    }

    verifyRegistrationPageLoaded() {
        cy.contains('Create new patient', { timeout: 300000 }).should('be.visible');
    }

    verifyMandatoryFields() {
        // Name fields marked as required by the form
        cy.get('#givenName', { timeout: 10000 }).should('be.visible').and('have.attr', 'required');
        cy.get('#familyName', { timeout: 10000 }).should('be.visible').and('have.attr', 'required');

        // Mandatory sections should be present for user input
        cy.contains('legend', 'Sex', { timeout: 10000 }).should('be.visible');
        cy.get('#gender-option-male', { timeout: 10000 }).should('be.visible');
        cy.get('#gender-option-female', { timeout: 10000 }).should('be.visible');

        cy.get('[data-testid="birthdate"]', { timeout: 10000 }).should('exist');
        cy.get('input[name="birthdate"]', { timeout: 10000 }).should('exist');
    }

    setPatientNameKnown(option: 'Yes' | 'No') {
        cy.contains('span', "Patient's Name is Known?", { timeout: 10000 })
            .closest('div')
            .next('[role="tablist"]')
            .contains('button', option, { timeout: 10000 })
            .click();
    }

    verifyNameFieldsVisible() {
        cy.get('#givenName', { timeout: 10000 }).should('be.visible');
        cy.get('#middleName', { timeout: 10000 }).should('be.visible');
        cy.get('#familyName', { timeout: 10000 }).should('be.visible');
    }

    verifyNameFieldsNotVisible() {
        cy.get('#givenName', { timeout: 10000 }).should('not.exist');
        cy.get('#middleName', { timeout: 10000 }).should('not.exist');
        cy.get('#familyName', { timeout: 10000 }).should('not.exist');
    }

    setDateOfBirthKnown(option: 'Yes' | 'No') {
        cy.contains('span', 'Date of Birth Known?', { timeout: 20000 })
            .closest('div')
            .next('[role="tablist"]')
            .contains('button', option, { timeout: 20000 })
            .click();
    }

    verifyDobKnownYesFlow() {
        cy.get('[data-testid="birthdate"]', { timeout: 10000 }).should('exist');
        cy.get('[data-testid="birthdate"] [data-type="day"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="birthdate"] [data-type="month"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="birthdate"] [data-type="year"]', { timeout: 10000 }).should('be.visible');
    }

    verifyDobKnownNoFlow() {
        cy.get('[data-testid="birthdate"]', { timeout: 10000 }).should('not.exist');
        cy.get('#yearsEstimated', { timeout: 10000 }).should('be.visible');
        cy.get('#monthsEstimated', { timeout: 10000 }).should('be.visible');
    }

    clickRegisterPatient() {
        cy.get('button[type="submit"]', { timeout: 150000 }).should('be.enabled');
        cy.contains('button', 'Register patient', { timeout: 150000 }).should('be.enabled');
        cy.contains('button', 'Register patient', { timeout: 150000 }).click();
    }
       

    enterFirstName(firstName: string) {
        cy.wait(1000); 
        cy.get('#givenName', { timeout: 10000 })
        .should('be.visible')
        .clear().type(firstName);
    }

    enterFamilyName(familyName: string) {
        cy.get('#familyName', { timeout: 10000 })
        .should('be.visible')
        .clear().type(familyName);
    }

    selectSexMale() {
        cy.get('#gender-option-male', { timeout: 10000 }).check({ force: true });
    }

    selectSexFemale() {
        cy.get('#gender-option-female', { timeout: 10000 }).check({ force: true });
    }

    enterBirthdate(day: string, month: string, year: string) {
        cy.get('[data-testid="birthdate"] [data-type="day"]', { timeout: 10000 }).click().type(day);
        cy.get('[data-testid="birthdate"] [data-type="month"]', { timeout: 10000 }).click().type(month);
        cy.get('[data-testid="birthdate"] [data-type="year"]', { timeout: 10000 }).click().type(year);
    }

    fillRequiredFields(data: {
        firstName?: string;
        familyName?: string;
        sex?: 'male' | 'female';
        birthdate?: { day: string; month: string; year: string };
    }) {
        if (data.firstName) {
            this.enterFirstName(data.firstName);
        }

        if (data.familyName) {
            this.enterFamilyName(data.familyName);
        }

        if (data.sex === 'male') {
            this.selectSexMale();
        }

        if (data.sex === 'female') {
            this.selectSexFemale();
        }

        if (data.birthdate) {
            this.enterBirthdate(data.birthdate.day, data.birthdate.month, data.birthdate.year);
        }
    }

    preventDoubleSubmitOnRapidClicks(data: {
        firstName: string;
        familyName: string;
        sex: 'male' | 'female';
        birthdate: { day: string; month: string; year: string };
    }) {
        let requestCount = 0;

        cy.intercept('POST', '**/ws/rest/v1/patient**', (req) => {
            requestCount += 1;
            req.reply({
                statusCode: 201,
                body: { uuid: Cypress._.random(100000, 999999).toString() }
            });
        }).as('createPatient');

        this.fillRequiredFields(data);
        cy.contains('button', 'Register patient', { timeout: 150000 })
            .should('be.enabled')
            .dblclick();

        cy.wait('@createPatient', { timeout: 10000 });
        cy.then(() => {
            expect(requestCount).to.eq(1);
        });
    }

    verifyRequiredFieldErrors(expectedErrors: string[]) {
        cy.get('[role="alertdialog"]', { timeout: 10000 }).should('be.visible').within(() => {
            cy.contains('The following fields have errors:', { timeout: 10000 }).should('be.visible');
            expectedErrors.forEach((field) => {
                cy.contains('li', field, { timeout: 10000 }).should('be.visible');
            });

            this.requiredErrorFields
                .filter((field) => !expectedErrors.includes(field))
                .forEach((field) => {
                    cy.contains('li', field, { timeout: 10000 }).should('not.exist');
                });
        });
    }

    verifyNoRequiredFieldErrors() {
        cy.contains('The following fields have errors:', { timeout: 10000 }).should('not.exist');
    }
}

export default RegistrationPage;