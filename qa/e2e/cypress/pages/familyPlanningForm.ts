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

    verifyCounsellingNoHidesDownstreamFields() {
        cy.get('input[id="counsellingDone-No"]', { timeout: this.timeout }).should('be.checked');
        this.downstreamQuestionIds.forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"]`).should('not.exist');
        });
        this.downstreamSections.forEach((section) => {
            cy.contains(section).should('not.exist');
        });
    }

    saveAndVerifyCounsellingNo(clientType: 'New Family Planning Client' | 'Continuing Family Planning Client') {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        cy.wait('@saveFamilyPlanning', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath?: string; value?: unknown }>;
            const valueFor = (fieldId: string) => {
                const value = observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`)?.value;
                return typeof value === 'object' && value !== null ? (value as { uuid?: string }).uuid : value;
            };

            expect(
                observations.map((observation) => observation.formFieldPath).sort(),
                'submitted Family Planning observations'
            ).to.deep.equal(['rfe-forms-counsellingDone', 'rfe-forms-familyPlanningClientType']);
            expect(valueFor('familyPlanningClientType'), 'saved client type').to.equal(this.clientTypeAnswers[clientType]);
            expect(valueFor('counsellingDone'), 'saved counselling done').to.equal(this.noAnswer);
        });
        cy.contains('button', /^Save$/, { timeout: this.timeout }).should('not.exist');
    }

    private readonly noAnswer = '1066AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    private readonly clientTypeAnswers = {
        'New Family Planning Client': '5f3c9e14-0a27-4e5a-b243-e2c608a4d7f6',
        'Continuing Family Planning Client': '7a5e0b36-2c49-4e7c-8465-04e82ac6f9b8',
    };

    private readonly downstreamQuestionIds = [
        'purposeOfVisit',
        'parity',
        'chosenFamilyPlanningMethod',
        'familyPlanningMethodDispensed',
    ];

    private readonly downstreamSections = [
        'Obstetric Profile',
        'Method Record',
        'Pregnancy Assessment',
        'LAM Assessment',
        'Implant Eligibility Assessment',
        'Implant Procedure',
        'Method Removal',
    ];
}

export default FamilyPlanningFormPage;
