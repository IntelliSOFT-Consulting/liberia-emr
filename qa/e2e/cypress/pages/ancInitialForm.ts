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