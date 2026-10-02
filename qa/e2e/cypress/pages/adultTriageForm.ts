import TriageFormPage from './triageForm';

class AdultTriageFormPage extends TriageFormPage {
    verifyAdultNumericLimits() {
        this.verifyNumericLimits();
        this.verifyNumericFieldLimits([
            { id: 'sbp', min: '0', max: '250', below: '-1', above: '251' },
            { id: 'dbp', min: '0', max: '150', below: '-1', above: '151' },
            { id: 'pain_score', min: '0', max: '10', below: '-1', above: '11' }
        ]);
    }

    verifyDiastolicMustBeBelowSystolic() {
        [
            { id: 'temp', value: '37.2' },
            { id: 'hr', value: '78' },
            { id: 'rr', value: '18' },
            { id: 'sbp', value: '120' },
            { id: 'dbp', value: '120' },
            { id: 'spo2', value: '98' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' },
            { id: 'pain_score', value: '0' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(value).blur();
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.contains('Diastolic pressure cannot be greater than or equal to systolic pressure', {
            timeout: this.timeout
        }).scrollIntoView().should('be.visible');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyPainScoreRequired() {
        [
            { id: 'temp', value: '37.2' },
            { id: 'hr', value: '78' },
            { id: 'rr', value: '18' },
            { id: 'sbp', value: '120' },
            { id: 'dbp', value: '80' },
            { id: 'spo2', value: '98' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(value).blur();
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('#pain_score', { timeout: this.timeout }).should('have.attr', 'aria-invalid', 'true');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

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

        cy.contains('legend', 'Ebola Screening Result').should('not.exist');
        ['triage_category_child', 'whz', 'red_signs_child', 'yellow_signs_child'].forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"], #${fieldId}`).should('not.exist');
        });
    }
}

export default AdultTriageFormPage;