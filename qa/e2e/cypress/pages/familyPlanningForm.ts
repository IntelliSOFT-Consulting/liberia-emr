class FamilyPlanningFormPage {
    constructor(
        private readonly timeout = 20000,
        private readonly chartLoadTimeout = 60000,
    ) {}

    private checkOption(id: string) {
        cy.get(`input[id="${id}"]`, { timeout: this.timeout }).should('not.be.disabled');
        cy.get(`label[for="${id}"]`, { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible')
            .click();
        cy.get(`input[id="${id}"]`).should('be.checked');
    }

    openClinicalForms() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: this.chartLoadTimeout })
            .should('be.visible');
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.chartLoadTimeout })
            .should('be.visible')
            .click();
    }

    selectForm() {
        cy.contains('a.cds--link', '3. Family Planning', { timeout: this.chartLoadTimeout }).click();
    }

    reopenForm() {
        cy.reload();
        this.openClinicalForms();
        this.selectForm();
    }

    selectClientType(clientType: 'New Family Planning Client' | 'Continuing Family Planning Client') {
        this.checkOption(`familyPlanningClientType-${clientType}`);
    }

    selectCounsellingDone(answer: 'Yes' | 'No') {
        this.checkOption(`counsellingDone-${answer}`);
    }

    selectPurposeForCommodities() {
        cy.contains('label', /^For Commodities$/, { timeout: this.timeout })
            .invoke('attr', 'for')
            .then((id) => {
                expect(id, 'For Commodities checkbox identifier').to.be.a('string').and.not.be.empty;
                if (!id) {
                    throw new Error('For Commodities label is missing its checkbox identifier');
                }
                this.checkOption(id);
            });
    }

    verifyRequiredFieldBlocksSave(fieldId: 'familyPlanningClientType' | 'counsellingDone' | 'purposeOfVisit') {
        cy.get(`input[id^="${fieldId}-"]`, { timeout: this.timeout }).should('not.be.checked');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        cy.get(`[data-testid="${fieldId}-label"]`, { timeout: this.timeout })
            .parents()
            .filter(':contains("Field is mandatory")')
            .first()
            .should(($question) => {
                expect($question.find('[data-testid$="-label"]'), 'questions in error container').to.have.length(1);
            })
            .contains('Field is mandatory')
            .scrollIntoView()
            .should('be.visible');
        cy.get('@saveFamilyPlanning.all').should('have.length', 0);
    }

    verifyEmptyPurposeOfVisitBlocksSave() {
        cy.get('input[id^="purposeOfVisit-"]', { timeout: this.timeout }).should('not.be.checked');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        // Nothing appears on screen to wait for, so give a save request time to be sent.
        cy.wait(3000);
        cy.get('@saveFamilyPlanning.all').should('have.length', 0);
        cy.get('label[for^="purposeOfVisit-"]').should('be.visible');
        cy.contains('button', /^Save$/).should('be.visible');
    }
}

export default FamilyPlanningFormPage;
