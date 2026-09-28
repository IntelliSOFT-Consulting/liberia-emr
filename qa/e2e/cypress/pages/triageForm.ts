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

    verifyNumericPrecision() {
        [
            { id: 'hr', value: '78.5' },
            { id: 'rr', value: '18.5' },
            { id: 'spo2', value: '97.5' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('have.attr', 'step', '1')
                .type(`{selectall}${value}`)
                .blur()
                .should(($input) => {
                    const input = $input[0] as HTMLInputElement;
                    expect(input.value === value && input.validity.valid, `${id} must not accept decimals`).to.equal(false);
                });
        });

        [
            { id: 'temp', value: '37.2' },
            { id: 'weight', value: '20.5' },
            { id: 'height', value: '120.5' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('have.attr', 'step', '0.1')
                .type(`{selectall}${value}`)
                .blur()
                .should('have.value', value)
                .should(($input) => {
                    expect(($input[0] as HTMLInputElement).validity.valid, `${id} accepts decimals`).to.equal(true);
                });
        });
    }

    verifyClinicalWarningsAllowSave() {
        cy.get('#ebola_screen-Negative', { timeout: this.timeout }).scrollIntoView().check({ force: true });
        cy.get('#triage_category_child', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', 'Non-urgent Priority', {
            timeout: this.timeout
        }).click();

        [
            { id: 'temp', value: '38.1' },
            { id: 'hr', value: '101' },
            { id: 'rr', value: '27' },
            { id: 'spo2', value: '94' },
            { id: 'weight', value: '20.5' },
            { id: 'height', value: '120.5' },
            { id: 'wz_score', value: '0' },
            { id: 'muac', value: '15.5' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(`{selectall}${value}`).blur();
        });

        [
            'Temperature is outside the normal range (36–38 °C). Please verify the reading.',
            'Heart Rate is outside the normal range (60–100 bpm). Please verify the reading.',
            'Respiratory Rate is outside the normal range (12–26 breaths/min). Please verify the reading.',
            'SpO₂ below 95% — please verify the reading and consider clinical review.'
        ].forEach((warning) => {
            cy.contains(warning, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveTriage', { timeout: this.timeout }).its('response.statusCode').should('be.oneOf', [200, 201]);
    }
}

export default TriageFormPage;