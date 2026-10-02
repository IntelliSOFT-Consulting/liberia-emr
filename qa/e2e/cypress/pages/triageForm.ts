type ChildPriority = 'Non-urgent Priority' | 'Urgent Priority' | 'Emergency Priority';

class TriageFormPage {
    constructor(protected readonly timeout = 20000) {}

    private readonly categoryNames: Record<ChildPriority, string> = {
        'Non-urgent Priority': 'Green',
        'Urgent Priority': 'Yellow',
        'Emergency Priority': 'Red'
    };

    private readonly normalVitals = [
        { id: 'temp', value: '37.2' },
        { id: 'hr', value: '78' },
        { id: 'rr', value: '18' },
        { id: 'spo2', value: '98' },
        { id: 'weight', value: '20.5' },
        { id: 'height', value: '120.5' },
        { id: 'muac', value: '15.5' }
    ];

    private selectChildCategory(category: ChildPriority) {
        cy.get('#triage_category_child', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
        });
        cy.contains('[role="option"], .cds--list-box__menu-item', category, { timeout: this.timeout }).click();
    }

    private enterVitals(vitals = this.normalVitals) {
        vitals.forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(`{selectall}${value}`).blur();
        });
    }

    private submitAssessment() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
    }

    private assertCodedAnswer(value: string | number | undefined, expectedName: string) {
        expect(value, `${expectedName} coded answer`).to.be.a('string');
        cy.request<{ display: string }>(`/openmrs/ws/rest/v1/concept/${value}?v=custom:(display)`)
            .its('body.display')
            .should((display) => {
                expect(display.trim().toLowerCase()).to.equal(expectedName.toLowerCase());
            });
    }

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
        cy.get('#whz', { timeout: this.timeout }).scrollIntoView().should('be.visible').and('be.disabled');
        ['sbp', 'dbp', 'bmi', 'pain_score'].forEach((fieldId) => {
            cy.get(`#${fieldId}`).should('not.exist');
        });
    }

    verifyEbolaScreeningRequired() {
        this.selectChildCategory('Non-urgent Priority');

        this.submitAssessment();

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

        this.submitAssessment();

        cy.get('#triage_category_child', { timeout: this.timeout })
            .closest('.cds--dropdown__wrapper')
            .find('.cds--form-requirement')
            .should('not.be.empty');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyChildCategoryOptions() {
        cy.get('#triage_category_child', { timeout: this.timeout }).scrollIntoView().within(() => {
            cy.get('button[role="combobox"]').click();
            cy.get('[role="option"]', { timeout: this.timeout }).should(($options) => {
                const labels = [...$options]
                    .map((option) => option.textContent?.trim())
                    .filter((label) => label !== 'Choose an option');
                expect(labels).to.deep.equal([
                    'Non-urgent Priority',
                    'Urgent Priority',
                    'Emergency Priority'
                ]);
            });
        });
    }

    verifyNumericLimits() {
        [
            { id: 'temp', min: '20', max: '45', below: '19.9', above: '45.1' },
            { id: 'hr', min: '0', max: '300', below: '-1', above: '301' },
            { id: 'rr', min: '0', max: '80', below: '-1', above: '81' },
            { id: 'spo2', min: '0', max: '100', below: '-1', above: '101' },
            { id: 'weight', min: '0', max: '250', below: '-0.1', above: '250.1' },
            { id: 'height', min: '10', max: '272', below: '9.9', above: '272.1' }
        ].forEach(({ id, min, max, below, above }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('have.attr', 'min', min)
                .and('have.attr', 'max', max);

            [min, max].forEach((value) => {
                cy.get(`#${id}`).type(`{selectall}${value}`).blur().should('have.value', value);
            });

            [below, above].forEach((value) => {
                cy.get(`#${id}`).type(`{selectall}${value}`).blur();
                cy.contains('button', 'Save', { timeout: this.timeout }).click();
                cy.get(`#${id}`).should('have.attr', 'aria-invalid', 'true');
            });
        });
    }

    verifyNumericPrecision() {
        cy.get('#ebola_screen-Negative', { timeout: this.timeout }).scrollIntoView().check({ force: true });
        this.selectChildCategory('Non-urgent Priority');
        this.enterVitals();

        [
            { id: 'hr', value: '7.5', original: '78' },
            { id: 'rr', value: '1.5', original: '18' },
            { id: 'spo2', value: '9.5', original: '98' }
        ].forEach(({ id, value, original }) => {
            cy.get(`#${id}`, { timeout: this.timeout })
                .scrollIntoView()
                .should('have.attr', 'step', '1')
                .type(`{selectall}${value}`)
                .blur()
                .then(($input) => {
                    const input = $input[0] as HTMLInputElement;
                    if (input.value === value) {
                        this.submitAssessment();
                        cy.get(`#${id}`).should('have.attr', 'aria-invalid', 'true');
                        cy.get('@saveTriage.all').should('have.length', 0);
                    } else {
                        expect(input.value, `${id} must not silently change decimals`).to.equal(original);
                    }
                });
            cy.get(`#${id}`).type(`{selectall}${original}`).blur();
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
        this.selectChildCategory('Non-urgent Priority');

        this.enterVitals([
            { id: 'temp', value: '38.1' },
            { id: 'hr', value: '101' },
            { id: 'rr', value: '27' },
            { id: 'spo2', value: '94' },
            { id: 'weight', value: '20.5' },
            { id: 'height', value: '120.5' },
            { id: 'muac', value: '15.5' }
        ]);

        [
            'Temperature is outside the normal range (36–38 °C). Please verify the reading.',
            'Heart Rate is outside the normal range (60–100 bpm). Please verify the reading.',
            'Respiratory Rate is outside the normal range (12–26 breaths/min). Please verify the reading.',
            'SpO₂ below 95% — please verify the reading and consider clinical review.'
        ].forEach((warning) => {
            cy.contains(warning, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        });

        this.submitAssessment();
        cy.wait('@saveTriage', { timeout: this.timeout }).its('response.statusCode').should('be.oneOf', [200, 201]);
    }

    verifyHiddenSignsAreNotSubmitted() {
        cy.get('#ebola_screen-Negative', { timeout: this.timeout }).scrollIntoView().check({ force: true });
        this.selectChildCategory('Urgent Priority');

        cy.get('#triage_category_child').should('contain.text', 'Urgent Priority');
        cy.contains('legend', 'Urgent priority signs', { timeout: this.timeout })
            .scrollIntoView()
            .closest('fieldset')
            .find('input[type="checkbox"]')
            .first()
            .scrollIntoView()
            .check({ force: true })
            .should('be.checked');

        this.selectChildCategory('Emergency Priority');
        cy.contains('legend', 'Urgent priority signs').should('not.exist');
        cy.contains('legend', 'Emergency Signs', { timeout: this.timeout })
            .scrollIntoView()
            .closest('fieldset')
            .find('input[type="checkbox"]')
            .first()
            .scrollIntoView()
            .check({ force: true })
            .should('be.checked');

        this.selectChildCategory('Non-urgent Priority');
        cy.contains('legend', 'Emergency Signs').should('not.exist');

        this.enterVitals();

        this.submitAssessment();
        cy.wait('@saveTriage', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            expect(request.body.obs, 'submitted triage observations').to.be.an('array');
            ['yellow_signs_child', 'red_signs_child'].forEach((fieldId) => {
                expect(
                    request.body.obs.some((observation: { formFieldPath?: string }) =>
                        observation.formFieldPath?.includes(fieldId)
                    ),
                    `hidden ${fieldId} observations`
                ).to.equal(false);
            });
        });
    }

    verifySavedAssessment(category: ChildPriority = 'Non-urgent Priority', ebolaAnswer: 'Negative' | 'Positive' = 'Negative') {
        cy.get(`#ebola_screen-${ebolaAnswer}`, { timeout: this.timeout }).scrollIntoView().check({ force: true });
        this.selectChildCategory(category);

        if (category === 'Urgent Priority') {
            cy.contains('legend', 'Urgent priority signs', { timeout: this.timeout })
                .closest('fieldset')
                .within(() => {
                    cy.contains('label', 'Nurse concern').click();
                    cy.get('input[type="checkbox"]:checked').should('have.length', 1);
                });
        }
        if (category === 'Emergency Priority') {
            cy.contains('legend', 'Emergency Signs', { timeout: this.timeout })
                .closest('fieldset')
                .within(() => {
                    cy.contains('label', 'Severe burns').click();
                    cy.get('input[type="checkbox"]:checked').should('have.length', 1);
                });
        }

        this.enterVitals();

        this.submitAssessment();
        cy.wait('@saveTriage', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath: string; value: string | number }>;
            expect(observations, 'submitted triage observations').to.be.an('array');
            const observationFor = (fieldId: string) =>
                observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`);

            this.assertCodedAnswer(observationFor('ebola_screen')?.value, ebolaAnswer === 'Negative' ? 'No' : 'Yes');
            this.assertCodedAnswer(observationFor('triage_category_child')?.value, this.categoryNames[category]);
            this.normalVitals.forEach(({ id, value }) => {
                expect(observationFor(id)?.value, `saved ${id}`).to.equal(Number(value));
            });
            if (category === 'Urgent Priority') {
                this.assertCodedAnswer(observationFor('yellow_signs_child')?.value, 'Nurse concern');
            } else {
                expect(observationFor('yellow_signs_child')).to.be.undefined;
            }
            if (category === 'Emergency Priority') {
                this.assertCodedAnswer(observationFor('red_signs_child')?.value, 'Severe burns');
            } else {
                expect(observationFor('red_signs_child')).to.be.undefined;
            }
        });
    }
}

export default TriageFormPage;