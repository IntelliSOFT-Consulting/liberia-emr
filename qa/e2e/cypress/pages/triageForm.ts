class TriageFormPage {
    constructor(private readonly timeout = 20000) {}

    openClinicalForms() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.timeout }).click();
    }

    selectForm() {
        cy.contains('a.cds--link', 'Triage Form', { timeout: this.timeout }).click();
    }

    verifyChildFormContract() {
        cy.contains('p', 'Triage Assessment', { timeout: this.timeout }).should('be.visible');

        ['Vital Signs', 'Triage Category'].forEach((section) => {
            cy.contains('.cds--accordion__title', section, { timeout: this.timeout })
                .scrollIntoView()
                .should('be.visible');
        });

        cy.get('input[name="ebola_screen"]', { timeout: this.timeout }).should('have.length', 2);
        cy.get('#triage_category_child', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');
        cy.get('[data-testid="triage_category_child-label"]', { timeout: this.timeout })
            .should('contain.text', 'Triage Category (Child)')
            .find('[title="Required"]')
            .should('exist');
        cy.get('#wz_score', { timeout: this.timeout }).should('be.visible');
        ['sbp', 'dbp', 'bmi', 'pain_score'].forEach((fieldId) => {
            cy.get(`#${fieldId}`).should('not.exist');
        });
    }
}

export default TriageFormPage;