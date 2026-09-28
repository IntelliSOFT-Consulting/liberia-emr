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

    verifyEbolaScreeningRequired() {
        cy.get('#triage_category_child', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', 'Non-urgent Priority', {
            timeout: this.timeout
        }).click();

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('input[name="ebola_screen"]', { timeout: this.timeout })
            .first()
            .closest('fieldset')
            .find('.cds--radio-button__validation-msg')
            .should('not.be.empty');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyChildCategoryRequired() {
        cy.get('#ebola_screen-Negative', { timeout: this.timeout })
            .scrollIntoView()
            .check({ force: true });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('#triage_category_child', { timeout: this.timeout })
            .closest('.cds--dropdown__wrapper')
            .find('.cds--form-requirement')
            .should('not.be.empty');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyTemperatureLimits() {
        cy.get('#temp', { timeout: this.timeout })
            .scrollIntoView()
            .should('have.attr', 'min', '20')
            .and('have.attr', 'max', '45');

        ['20', '45'].forEach((value) => {
            cy.get('#temp').type(`{selectall}${value}`).blur().should('have.value', value);
        });

        ['19.9', '45.1'].forEach((value) => {
            cy.get('#temp').type(`{selectall}${value}`).blur();
            cy.contains('button', 'Save', { timeout: this.timeout }).click();
            cy.get('#temp').should('have.attr', 'aria-invalid', 'true');
        });
    }
}

export default TriageFormPage;