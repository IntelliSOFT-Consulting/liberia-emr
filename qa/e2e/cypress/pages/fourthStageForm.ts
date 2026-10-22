type Observation = { formFieldPath?: string; value?: unknown };

class FourthStageFormPage {
    static readonly formName = '4. Fourth Stage Monitoring for Woman and Baby';

    static readonly messages = {
        systolicRange:
            'Systolic Blood Pressure is outside the permitted range. Enter a whole number from 0 to 250 mmHg.',
        diastolicRange:
            'Diastolic Blood Pressure is outside the permitted range. Enter a whole number from 0 to 150 mmHg.',
        pulseRange:
            'Pulse/Heart Rate is outside the permitted range. Enter a whole number from 0 to 250 beats/min.',
    };

    constructor(
        private readonly timeout = 20000,
        private readonly chartLoadTimeout = 60000,
    ) {}

    openClinicalForms() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: this.chartLoadTimeout })
            .should('be.visible');
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.chartLoadTimeout })
            .should('be.visible')
            .click();
    }

    selectForm() {
        cy.contains('a.cds--link', FourthStageFormPage.formName, { timeout: this.chartLoadTimeout }).click();
        cy.get('#complications_of_woman', { timeout: this.chartLoadTimeout }).should('exist');
        cy.get('#observation_time', { timeout: this.chartLoadTimeout }).should('exist');
    }

    setNumber(fieldId: string, value: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .type(`{selectall}${value}`)
            .should('have.value', value)
            .blur();
    }

    setTime(value: string) {
        cy.get('#observation_time', { timeout: this.timeout })
            .scrollIntoView()
            .type(`{selectall}${value}`)
            .should('have.value', value)
            .blur();
    }

    private choose(fieldId: string, option: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', option, { timeout: this.timeout }).click();
    }

    answer(fieldId: 'baby_breathing' | 'baby_suck', answer: 'Yes' | 'No') {
        const id = `${fieldId}-${answer}`;
        cy.get(`label[for="${id}"]`, { timeout: this.timeout }).scrollIntoView().click();
        cy.get(`input[id="${id}"]`).should('be.checked');
    }

    fillRequiredFields() {
        this.choose('complications_of_woman', 'None');
        this.choose('complications_of_baby', 'None');
        this.choose('monitoring_frequency', 'Every 15 minutes for first 2 hours');
        this.setTime('10:15');
        this.answer('baby_breathing', 'Yes');
        this.answer('baby_suck', 'Yes');
        this.choose('temperature_status', 'Normal');
    }

    verifyFieldInvalid(fieldId: string, message: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .should('have.attr', 'aria-invalid', 'true')
            .parents()
            .filter(`:contains("${message}")`)
            .first()
            .should(($question) => {
                expect($question.find(`#${fieldId}`), `error stays on ${fieldId}`).to.have.length(1);
                expect($question.find('#bp_sys, #bp_dia, #pulse').not(`#${fieldId}`), 'other vital fields').to.have.length(0);
            })
            .contains(message)
            .scrollIntoView()
            .should('be.visible');
    }

    verifyFieldValid(fieldId: string, message: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).should('not.have.attr', 'aria-invalid', 'true');
        cy.contains(message).should('not.exist');
    }

    verifyValueRemains(fieldId: string, value: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).should('have.value', value);
    }

    verifySaveBlocked() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('blockedSave');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        cy.wait(3000);
        cy.get('@blockedSave.all').should('have.length', 0);
        cy.contains('button', /^Save$/).should('be.visible');
    }

    saveAndGetObservations() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFourthStage');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        return cy.wait('@saveFourthStage', { timeout: this.timeout }).then(({ request, response }) => {
            expect(request.url, 'encounter save URL').to.match(/\/ws\/rest\/v1\/encounter/);
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            cy.contains('button', /^Save$/, { timeout: this.chartLoadTimeout }).should('not.exist');
            return request.body.obs as Observation[];
        });
    }

    observationValue(observations: Observation[], fieldId: string) {
        const value = observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`)?.value;
        return typeof value === 'object' && value !== null ? (value as { uuid?: string }).uuid : value;
    }
}

export default FourthStageFormPage;
