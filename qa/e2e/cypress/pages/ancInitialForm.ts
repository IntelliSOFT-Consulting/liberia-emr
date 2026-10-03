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

    verifyObstetricHistoryConsistency() {
        const setNumber = (fieldId: string, value: string) =>
            cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().type(`{selectall}${value}`).blur();
        const saveAndCheckInvalidField = (fieldId: string) => {
            cy.contains('button', 'Save', { timeout: this.timeout }).click();
            cy.get(`#${fieldId}`, { timeout: this.timeout }).should('have.attr', 'aria-invalid', 'true');
        };

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