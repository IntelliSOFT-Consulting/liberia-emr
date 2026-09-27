class OpdConsultationFormPage {
    constructor(private readonly timeout = 20000) {}

    private readonly vitalFields = [
        { id: 'temperature', min: '25', max: '43', step: '0.1', value: '37.2' },
        { id: 'pulse', min: '0', max: '230', step: '1', value: '78' },
        { id: 'respiratoryRate', min: '0', max: '80', step: '1', value: '18' },
        { id: 'systolic', min: '0', max: '250', step: '1', value: '120' },
        { id: 'diastolic', min: '0', max: '150', step: '1', value: '80' },
        { id: 'spo2', min: '0', max: '100', step: '1', value: '98' },
        { id: 'weight', min: '0', max: '250', step: '0.1', value: '70.5' },
        { id: 'height', min: '10', max: '272', step: '0.1', value: '170' }
    ];

    private readonly generalExaminationGroups = [
        { id: 'jaundice', findingsId: 'jaundiceClinicalFindings' },
        { id: 'pallor', findingsId: 'pallorClinicalFindings' },
        { id: 'cyanosis', findingsId: 'cyanosisClinicalFindings' },
        { id: 'lymphadenopathy', findingsId: 'lymphadenopathyClinicalFindings' },
        { id: 'dehydration', findingsId: 'dehydrationClinicalFindings' },
        { id: 'fingerClubbing', findingsId: 'fingerClubbingClinicalFindings' },
        { id: 'edema', findingsId: 'edemaClinicalFindings' }
    ];

    private readonly systemicExaminationGroups = [
        { id: 'heent_status', findingsId: 'heentFindings' },
        { id: 'cvs_status', findingsId: 'cvsFindings' },
        { id: 'resp_status', findingsId: 'respiratoryFindings' },
        { id: 'gi_status', findingsId: 'giFindings' },
        { id: 'cns_status', findingsId: 'cnsFindings' },
        { id: 'msk_status', findingsId: 'musculoskeletalFindings' }
    ];

    private assertFieldHidden(fieldId: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).should('not.exist');
    }

    private selectDropdownOption(fieldId: string, option: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .within(() => {
                cy.get('button[role="combobox"]', { timeout: this.timeout }).click();
            });

        cy.contains('[role="option"], .cds--list-box__menu-item', option, { timeout: this.timeout })
            .scrollIntoView()
            .click({ force: true });

        cy.get(`#${fieldId}`, { timeout: this.timeout }).should('contain.text', option);
    }

    private enterDate(fieldId: string, date: Date) {
        const dateParts: Record<string, string> = {
            day: String(date.getDate()).padStart(2, '0'),
            month: String(date.getMonth() + 1).padStart(2, '0'),
            year: String(date.getFullYear())
        };

        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .within(() => {
                Object.entries(dateParts).forEach(([type, value]) => {
                    cy.get(`[data-type="${type}"]`, { timeout: this.timeout })
                        .click()
                        .type(value);
                });
            });
    }

    waitForChartToLoad() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
    }

    openClinicalForms() {
        this.waitForChartToLoad();
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.timeout }).click();
    }

    selectForm() {
        cy.contains('a.cds--link', 'OPD Consultation Form', { timeout: this.timeout }).click();
    }

    verifyFormContract() {
        [
            'Patient Category',
            'Clinical History',
            'Vitals',
            'General examination',
            'Systemic Examination'
        ].forEach((pageTitle) => {
            cy.contains('p', pageTitle, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible');
        });

        [
            'patientCategory',
            'encounterProvider',
            'encounterLocation',
            'encounterDate',
            'presentingComplaint'
        ].forEach((fieldId) => {
            cy.get(`#${fieldId}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible');
        });

        [
            'patientCategory',
            'encounterProvider',
            'encounterLocation',
            'encounterDate',
            'presentingComplaint'
        ].forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"] [title="Required"]`, { timeout: this.timeout })
                .should('exist');
        });
    }

    verifyVitalsInputContract() {
        cy.contains('p', 'Vitals', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        this.vitalFields.forEach(({ id, min, max, step, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible')
                .and('have.attr', 'type', 'number')
                .and('have.attr', 'min', min)
                .and('have.attr', 'max', max)
                .and('have.attr', 'step', step)
                .clear()
                .type(value)
                .should('have.value', value);
        });
    }

    verifyBmiCalculation() {
        cy.get('#bmi', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible')
            .and('be.disabled');

        cy.get('#weight', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('70')
            .should('have.value', '70');

        cy.get('#height', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('170')
            .should('have.value', '170');

        cy.get('#bmi', { timeout: this.timeout }).should(($bmi) => {
            const bmiValue = Number.parseFloat($bmi.val() as string);
            expect(bmiValue).to.be.closeTo(24.2, 0.1);
        });
    }

    verifyVitalsValidationErrors() {
        cy.get('#presentingComplaint', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated OPD consultation');

        cy.get('#temperature', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('44')
            .should('have.value', '44');

        cy.get('#spo2', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('101')
            .should('have.value', '101');

        cy.get('#systolic', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('120')
            .should('have.value', '120');

        cy.get('#diastolic', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('120')
            .should('have.value', '120');

        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.contains('Value must be lower than 43', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
        cy.contains('Value must be lower than 100', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
        cy.contains('Diastolic pressure cannot be greater than or equal to systolic pressure', {
            timeout: this.timeout
        })
            .scrollIntoView()
            .should('be.visible');
    }

    verifyGeneralExaminationRadioGroups() {
        cy.contains('p', 'General examination', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        this.generalExaminationGroups.forEach(({ id, findingsId }) => {
            cy.get(`#${id}-Yes`, { timeout: this.timeout })
                .scrollIntoView()
                .should('exist');
            cy.get(`#${id}-No`, { timeout: this.timeout }).should('exist');

            cy.get(`#${id}-Yes`, { timeout: this.timeout })
                .check({ force: true });
            cy.get(`#${id}-Yes`, { timeout: this.timeout }).should('be.checked');

            cy.get(`#${findingsId}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible')
                .clear()
                .type('Automated clinical findings');

            cy.get(`#${id}-No`, { timeout: this.timeout })
                .scrollIntoView()
                .check({ force: true });
            cy.get(`#${id}-No`, { timeout: this.timeout }).should('be.checked');

            cy.get('body').then(($body) => {
                const $findingsField = $body.find(`#${findingsId}`);

                if ($findingsField.length) {
                    cy.wrap($findingsField, { log: false }).should('not.be.visible');
                    return;
                }

                expect($findingsField, `${findingsId} hidden after No`).to.have.length(0);
            });
        });
    }

    verifySystemicExaminationRadioGroups() {
        cy.contains('p', 'Systemic Examination', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        this.systemicExaminationGroups.forEach(({ id, findingsId }) => {
            cy.get(`#${id}-Normal`, { timeout: this.timeout })
                .scrollIntoView()
                .should('exist');
            cy.get(`#${id}-Abnormal`, { timeout: this.timeout }).should('exist');

            cy.get(`#${id}-Abnormal`, { timeout: this.timeout }).check({ force: true });
            cy.get(`#${id}-Abnormal`, { timeout: this.timeout }).should('be.checked');

            cy.get(`#${findingsId}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible')
                .clear()
                .type('Automated systemic findings');

            cy.get(`#${id}-Normal`, { timeout: this.timeout })
                .scrollIntoView()
                .check({ force: true });
            cy.get(`#${id}-Normal`, { timeout: this.timeout }).should('be.checked');

            cy.get('body').then(($body) => {
                const $findingsField = $body.find(`#${findingsId}`);

                if ($findingsField.length) {
                    cy.wrap($findingsField, { log: false }).should('not.be.visible');
                    return;
                }

                expect($findingsField, `${findingsId} hidden after Normal`).to.have.length(0);
            });
        });
    }

    verifyFollowupConditionalDate() {
        this.assertFieldHidden('followupDate');

        cy.get('#followupRequired-Yes', { timeout: this.timeout })
            .scrollIntoView()
            .check({ force: true });
        cy.get('#followupRequired-Yes', { timeout: this.timeout }).should('be.checked');

        cy.get('#followupDate', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.enterDate('followupDate', tomorrow);

        cy.get('#followupDate input[type="text"][hidden]', { timeout: this.timeout })
            .should(
                'have.value',
                `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
                    tomorrow.getDate()
                ).padStart(2, '0')}`
            );
    }

    verifyOutcomeDispositionReferralFields() {
        this.selectDropdownOption('outcomeDisposition', 'Discharged');
        this.assertFieldHidden('referralDestination');
        this.assertFieldHidden('referralReason');

        this.selectDropdownOption('outcomeDisposition', 'Admitted');
        this.assertFieldHidden('referralDestination');
        this.assertFieldHidden('referralReason');

        this.selectDropdownOption('outcomeDisposition', 'Referred');
        cy.get('#referralDestination', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
        cy.get('#referralReason', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        cy.get('#presentingComplaint', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated OPD consultation');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.contains('Please enter the Referral Destination', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
    }

    fillCompleteValidFormAndSave() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveOpdConsultation');

        this.selectDropdownOption('patientCategory', 'First Visit');

        cy.get('#presentingComplaint', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated OPD consultation');
        cy.get('#hpc', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Symptoms started today');
        cy.get('#pmh', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('No significant history');

        this.vitalFields.forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .clear()
                .type(value)
                .should('have.value', value);
        });

        cy.get('#general_exam', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('General exam normal');

        this.generalExaminationGroups.forEach(({ id }) => {
            cy.get(`#${id}-No`, { timeout: this.timeout })
                .scrollIntoView()
                .check({ force: true });
            cy.get(`#${id}-No`, { timeout: this.timeout }).should('be.checked');
        });

        this.systemicExaminationGroups.forEach(({ id }) => {
            cy.get(`#${id}-Normal`, { timeout: this.timeout })
                .scrollIntoView()
                .check({ force: true });
            cy.get(`#${id}-Normal`, { timeout: this.timeout }).should('be.checked');
        });

        cy.get('#nonPharmAdvice', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Hydration and rest advised');
        cy.get('#followupRequired-No', { timeout: this.timeout })
            .scrollIntoView()
            .check({ force: true });
        cy.get('#followupRequired-No', { timeout: this.timeout }).should('be.checked');
        this.selectDropdownOption('outcomeDisposition', 'Discharged');

        cy.contains('button', 'Save', { timeout: this.timeout })
            .scrollIntoView()
            .click();

        cy.wait('@saveOpdConsultation', { timeout: this.timeout }).then(({ response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
        });
    }
}

export default OpdConsultationFormPage;