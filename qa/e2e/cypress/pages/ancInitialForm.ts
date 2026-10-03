import { toDateParts } from '../support/faker';

class ANCInitialFormPage {
    constructor(private readonly timeout = 20000) {}

    private setNumber(fieldId: string, value: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().type(`{selectall}${value}`).blur();
    }

    private enterDate(fieldId: string, date: Date) {
        const dateParts = toDateParts(date);
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().within(() => {
            Object.entries(dateParts).forEach(([part, value]) => {
                cy.get(`[data-type="${part}"]`, { timeout: this.timeout }).click().type(value);
            });
        });
    }

    private completeRequiredAssessmentFields() {
        [
            { id: 'gravida', value: '2' },
            { id: 'parity', value: '1' },
            { id: 'fullTermBirths', value: '1' },
            { id: 'pretermBirths', value: '0' },
            { id: 'abortions', value: '0' },
            { id: 'livingChildren', value: '1' },
            { id: 'systolicBloodPressure', value: '120' },
            { id: 'diastolicBloodPressure', value: '80' },
            { id: 'weight', value: '65' },
            { id: 'gestationalAge', value: '20' }
        ].forEach(({ id, value }) => this.setNumber(id, value));

        this.enterDate('lmp', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
        this.enterDate('returnDate', new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
        this.enterDate('healthCardIssueDate', new Date());
        cy.get('#pregnancyTrimester', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', '2nd trimester', { timeout: this.timeout }).click();
        cy.get('#womanReceivingIpt-No', { timeout: this.timeout }).check({ force: true });
    }

    verifyMaternalBpWarningsAllowSave() {
        this.completeRequiredAssessmentFields();
        this.setNumber('systolicBloodPressure', '140');
        this.setNumber('diastolicBloodPressure', '90');

        cy.contains('High Systolic BP (≥140 mmHg)', { timeout: this.timeout }).scrollIntoView().should('be.visible');
        cy.contains('High Diastolic BP (≥90 mmHg)', { timeout: this.timeout }).scrollIntoView().should('be.visible');

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveAncInitial', { timeout: this.timeout })
            .its('response.statusCode')
            .should('be.oneOf', [200, 201]);
    }

    verifyIptConditionalFields() {
        this.completeRequiredAssessmentFields();
        cy.get('[data-testid="iptpDeferralReason-label"]', { timeout: this.timeout }).should('be.visible');
        cy.get('#iptDoseAdministered').should('not.exist');

        cy.get('#womanReceivingIpt-Yes', { timeout: this.timeout }).check({ force: true });
        cy.get('[data-testid="iptpDeferralReason-label"]').should('not.exist');
        cy.get('#iptDoseAdministered', { timeout: this.timeout }).should('be.visible');

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.contains('Select the IPT dose administered', { timeout: this.timeout }).scrollIntoView().should('be.visible');
        cy.get('@saveAncInitial.all').should('have.length', 0);

        cy.get('#iptDoseAdministered').within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', '1st IPT dose', {
            timeout: this.timeout
        }).click();

        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveAncInitial', { timeout: this.timeout })
            .its('response.statusCode')
            .should('be.oneOf', [200, 201]);
    }

    verifyOptionalFetalFieldsCanBeBlank() {
        this.completeRequiredAssessmentFields();
        const optionalFetalFields = ['fundalHeight', 'fetalPresentation', 'fetalHeartTone', 'otherFindings'];
        optionalFetalFields.forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"] [title="Required"]`).should('not.exist');
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveAncInitial', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath?: string }>;
            optionalFetalFields.forEach((fieldId) => {
                expect(
                    observations.some((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`),
                    `optional ${fieldId} observation`
                ).to.equal(false);
            });
        });
    }

    verifyFetalAssessmentWarnings() {
        this.completeRequiredAssessmentFields();

        cy.get('#fetalPresentation', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', 'Breech', { timeout: this.timeout }).click();
        cy.contains('Non-vertex Presentation:', { timeout: this.timeout }).scrollIntoView().should('be.visible');

        cy.get('#fetalPresentation').within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', 'Vertex', { timeout: this.timeout }).click();
        cy.contains('Non-vertex Presentation:').should('not.exist');

        this.setNumber('fetalHeartTone', '100');
        cy.contains('Abnormal Fetal Heart Tone (<110 or >160 bpm):', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
        this.setNumber('fetalHeartTone', '140');
        cy.contains('Abnormal Fetal Heart Tone (<110 or >160 bpm):').should('not.exist');
    }

    openClinicalForms() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.timeout }).click();
    }

    selectForm() {
        cy.contains('a.cds--link', 'ANC Initial Visit', { timeout: this.timeout }).click();
    }

    verifyRequiredFieldsBlockSave() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('[aria-invalid="true"], .cds--form-requirement', { timeout: this.timeout })
            .filter(':visible')
            .should('exist');
        cy.get('@saveAncInitial.all').should('have.length', 0);
    }

    verifySuccessfulAssessmentSaved() {
        this.completeRequiredAssessmentFields();
        cy.get('#pregnancyTrimester').should('contain.text', '2nd trimester');
        cy.get('#womanReceivingIpt-No').should('be.checked');

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveAncInitial', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            expect(request.body.encounterType, 'submitted encounter type').to.be.a('string').and.not.be.empty;

            cy.request<{ name: string }>(
                `/openmrs/ws/rest/v1/encountertype/${request.body.encounterType}?v=custom:(name)`
            ).its('body.name').should('eq', 'ANC Initial Visit');

            const observations = request.body.obs as Array<{ formFieldPath?: string; value?: string | number }>;
            const observationFor = (fieldId: string) =>
                observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`);
            [
                { id: 'gravida', value: 2 },
                { id: 'parity', value: 1 },
                { id: 'fullTermBirths', value: 1 },
                { id: 'pretermBirths', value: 0 },
                { id: 'abortions', value: 0 },
                { id: 'livingChildren', value: 1 },
                { id: 'systolicBloodPressure', value: 120 },
                { id: 'diastolicBloodPressure', value: 80 },
                { id: 'weight', value: 65 },
                { id: 'gestationalAge', value: 20 }
            ].forEach(({ id, value }) => {
                expect(observationFor(id)?.value, `saved ${id}`).to.equal(value);
            });
            ['lmp', 'pregnancyTrimester', 'womanReceivingIpt', 'returnDate', 'healthCardIssueDate'].forEach((fieldId) => {
                expect(observationFor(fieldId)?.value, `saved ${fieldId}`).to.exist;
            });
        });
    }

    verifyObstetricHistoryConsistency() {
        const setNumber = (fieldId: string, value: string) =>
            cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().type(`{selectall}${value}`).blur();
        const saveAndCheckInvalidField = (fieldId: string) => {
            cy.contains('button', 'Save', { timeout: this.timeout }).click();
            cy.get(`#${fieldId}`, { timeout: this.timeout }).should('have.attr', 'aria-invalid', 'true');
        };

        this.completeRequiredAssessmentFields();
        [
            { id: 'gravida', value: '3' },
            { id: 'parity', value: '2' },
            { id: 'fullTermBirths', value: '1' },
            { id: 'pretermBirths', value: '1' },
            { id: 'abortions', value: '0' },
            { id: 'livingChildren', value: '2' }
        ].forEach(({ id, value }) => setNumber(id, value));

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');

        setNumber('gravida', '4');
        saveAndCheckInvalidField('gravida');
        setNumber('gravida', '3');

        setNumber('parity', '3');
        saveAndCheckInvalidField('parity');
        setNumber('parity', '1');
        saveAndCheckInvalidField('parity');
        setNumber('parity', '2');

        setNumber('livingChildren', '3');
        saveAndCheckInvalidField('livingChildren');

        setNumber('gravida', '1');
        setNumber('fullTermBirths', '0');
        setNumber('pretermBirths', '0');
        setNumber('abortions', '0');
        setNumber('livingChildren', '1');
        saveAndCheckInvalidField('livingChildren');

        cy.get('@saveAncInitial.all').should('have.length', 0);
    }

    verifyFormContract() {
        cy.contains('p', 'Initial ANC Assessment', { timeout: this.timeout }).should('be.visible');

        [
            'Obstetric History',
            'Physical Examination',
            'Maternal Assessment',
            'Fetal Assessment',
            'Preventive Interventions',
            'Management Notes',
            'Pregnant Woman Health Card'
        ].forEach((section) => {
            cy.contains('.cds--accordion__title', section, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible');
        });

        [
            'gravida',
            'parity',
            'lmp',
            'fullTermBirths',
            'pretermBirths',
            'abortions',
            'livingChildren',
            'systolicBloodPressure',
            'diastolicBloodPressure',
            'weight',
            'gestationalAge',
            'pregnancyTrimester',
            'womanReceivingIpt',
            'returnDate',
            'healthCardIssueDate'
        ].forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"] [title="Required"]`, { timeout: this.timeout })
                .should('exist');
        });
    }

    verifyPhysicalExamDescriptionsNotSavedWhenNormal() {
        this.completeRequiredAssessmentFields();

        const descriptions = [
            { id: 'physicalExamColour', description: 'colourAbnormalityDescription' },
            { id: 'heart', description: 'heartAbnormalityDescription' },
            { id: 'lungs', description: 'lungsAbnormalityDescription' },
            { id: 'breasts', description: 'breastsAbnormalityDescription' },
            { id: 'nipples', description: 'nipplesAbnormalityDescription' },
            { id: 'abdomen', description: 'abdomenAbnormalityDescription' },
            { id: 'extremities', description: 'extremitiesAbnormalityDescription' },
            { id: 'pelvicExamination', description: 'pelvicExaminationAbnormalityDescription' }
        ];

        descriptions.forEach(({ id, description }) => {
            cy.get(`#${id}-Normal`, { timeout: this.timeout }).scrollIntoView().check({ force: true });
            cy.get(`#${description}`).should('not.exist');

            cy.get(`#${id}-Abnormal`).check({ force: true });
            cy.get(`#${description}`).scrollIntoView().should('be.visible');
            cy.get(`[data-testid="${description}-label"] [title="Required"]`).should('exist');
            cy.get(`#${description}`).scrollIntoView().type('Automated abnormal finding');

            cy.get(`#${id}-Normal`).check({ force: true });
            cy.get(`#${description}`).should('not.exist');
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveAncInitial');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveAncInitial', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath?: string }>;
            descriptions.forEach(({ description }) => {
                expect(
                    observations.some((observation) => observation.formFieldPath?.includes(description)),
                    `hidden ${description} observation`
                ).to.equal(false);
            });
        });
    }
}

export default ANCInitialFormPage;