class ANCInitialFormPage {
    constructor(private readonly timeout = 20000) {}

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
}

export default ANCInitialFormPage;