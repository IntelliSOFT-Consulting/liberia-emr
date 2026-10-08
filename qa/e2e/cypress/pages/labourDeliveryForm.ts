type Observation = { formFieldPath?: string; value?: unknown };

export type DeliveryMethod = 'Spontaneous vaginal delivery (SVD)' | 'Cesarean section';
export type Perineum = 'Episiotomy' | 'Intact' | 'Laceration';
export type Anaesthesia = 'Local' | 'General' | 'None';

class LabourDeliveryFormPage {
    static readonly formName = '1. First and Second Stage of Labor and Delivery';

    static readonly messages = {
        repairRequired: 'Repair is required when the perineum shows an episiotomy or a laceration.',
        parityAboveGravida: 'Parity cannot be greater than Gravida.',
        spo2Range: 'Value must be between 0 and 100',
        systolicRange: 'Value must be between 0 and 250',
        diastolicRange: 'Value must be between 0 and 200',
        fetalHeartRateRange: 'Value must be between 60 and 220',
        required: 'Field is mandatory',
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
        cy.contains('a.cds--link', LabourDeliveryFormPage.formName, { timeout: this.chartLoadTimeout }).click();
        cy.get('#gravida', { timeout: this.chartLoadTimeout }).should('exist');
    }

    setNumber(fieldId: string, value: string) {
        // An emptied number input reverts to 0, so overwrite the selected text instead of clearing it.
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .type(`{selectall}${value}`)
            .should('have.value', value)
            .blur();
    }

    // Gravida and Parity may be pre-filled from ANC, so blank them explicitly for the required checks.
    clearNumber(fieldId: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().clear().blur();
    }

    verifyRequiredError(fieldId: 'gravida' | 'parity' | 'delivery_method') {
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .parents()
            .filter(`:contains("${LabourDeliveryFormPage.messages.required}")`)
            .first()
            .should(($question) => {
                expect($question.find('input, button[role="combobox"]'), 'inputs in error container').to.have.length(1);
            })
            .contains(LabourDeliveryFormPage.messages.required)
            .scrollIntoView()
            .should('be.visible');
    }

    verifyNumberValue(fieldId: string, value: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).should('have.value', value);
    }

    answer(fieldId: 'td2' | 'iron_folic_acid' | 'repair', answer: 'Yes' | 'No') {
        const id = `${fieldId}-${answer}`;
        cy.get(`label[for="${id}"]`, { timeout: this.timeout }).scrollIntoView().click();
        cy.get(`input[id="${id}"]`).should('be.checked');
    }

    private choose(fieldId: string, option: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', option, { timeout: this.timeout }).click();
    }

    selectDeliveryMethod(method: DeliveryMethod) {
        this.choose('delivery_method', method);
    }

    selectPerineum(perineum: Perineum) {
        this.choose('perineum', perineum);
    }

    selectAnaesthesia(anaesthesia: Anaesthesia) {
        this.choose('anaesthesia', anaesthesia);
    }

    fillRequiredFields(gravida = '2', parity = '1', method: DeliveryMethod = 'Spontaneous vaginal delivery (SVD)') {
        this.setNumber('gravida', gravida);
        this.setNumber('parity', parity);
        this.selectDeliveryMethod(method);
    }

    verifyMessageShown(message: string) {
        cy.contains(message, { timeout: this.timeout }).scrollIntoView().should('be.visible');
    }

    verifyMessageAbsent(message: string) {
        cy.contains(message).should('not.exist');
    }

    verifySaveBlocked() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('blockedSave');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        // A blocked save shows nothing to wait on, so give any request time to be sent.
        cy.wait(3000);
        cy.get('@blockedSave.all').should('have.length', 0);
        cy.contains('button', /^Save$/).should('be.visible');
    }

    saveAndGetObservations() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveLabourDelivery');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        return cy.wait('@saveLabourDelivery', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            return request.body.obs as Observation[];
        });
    }

    observationValue(observations: Observation[], fieldId: string) {
        const value = observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`)?.value;
        return typeof value === 'object' && value !== null ? (value as { uuid?: string }).uuid : value;
    }
}

export default LabourDeliveryFormPage;
