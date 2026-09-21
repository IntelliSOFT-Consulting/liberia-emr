class OpdConsultationFormPage {
    constructor(private readonly timeout = 20000) {}

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
}

export default OpdConsultationFormPage;