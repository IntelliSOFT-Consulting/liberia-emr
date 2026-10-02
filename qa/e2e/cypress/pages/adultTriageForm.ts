import TriageFormPage from './triageForm';

class AdultTriageFormPage extends TriageFormPage {
    verifyAdultFormContract() {
        cy.contains('p', 'Triage Assessment', { timeout: this.timeout }).should('be.visible');
        cy.contains('.cds--accordion__title', 'Vital Signs', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        ['temp', 'hr', 'rr', 'sbp', 'dbp', 'spo2', 'weight', 'height', 'pain_score'].forEach((fieldId) => {
            cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().should('be.visible');
            cy.get(`[data-testid="${fieldId}-label"] [title="Required"]`).should('exist');
        });

        cy.get('#bmi', { timeout: this.timeout }).scrollIntoView().should('be.visible').and('be.disabled');
        cy.get('#muac', { timeout: this.timeout }).should('be.visible');
        cy.get('[data-testid="muac-label"] [title="Required"]').should('not.exist');

        ['ebola_screen', 'triage_category_child', 'whz', 'red_signs_child', 'yellow_signs_child'].forEach((fieldId) => {
            cy.get(`#${fieldId}`).should('not.exist');
        });
    }
}

export default AdultTriageFormPage;