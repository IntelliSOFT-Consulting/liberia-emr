class OpdConsultationFormPage {
    constructor(private readonly timeout = 20000) {}

    private readonly vitalFields = [
        { id: 'temperature', min: '25', max: '43', step: '0.1', value: '37.2' },
        { id: 'pulse', min: '0', max: '230', step: '1', value: '78' },
        { id: 'respiratoryRate', min: '0', max: '80', step: '1', value: '18' },
        { id: 'systolic', min: '0', max: '250', step: '1', value: '120' },
        { id: 'diastolic', min: '0', max: '150', step: '1', value: '80' },
        { id: 'spo2', min: '0', max: '100', step: '1', value: '98' },
        { id: 'weight', min: '0', max: '250', step: '1', value: '70' },
        { id: 'height', min: '10', max: '272', step: '0.1', value: '170' }
    ];

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

    verifyRequiredFieldValidation() {
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('[data-testid="presentingComplaint-label"]', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible')
            .closest('.cds--form-item')
            .within(() => {
                cy.contains('Field is mandatory', { timeout: this.timeout }).should('be.visible');
            });

        cy.get('#presentingComplaint', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated OPD consultation');

        cy.get('[data-testid="presentingComplaint-label"]', { timeout: this.timeout })
            .closest('.cds--form-item')
            .should('not.contain', 'Field is mandatory');
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
}

export default OpdConsultationFormPage;