type Answer = 'Yes' | 'No';

class TbScreeningFormPage {
    constructor(private readonly timeout = 20000) {}

    private readonly requiredRadioGroupSelector = 'fieldset > legend [title="Required"]';

    private readonly requiredRadioGroupNames = [
        'contact_of_tb_patient',
        'previously_treated_for_tb',
        'coughing_2_weeks_or_more',
        'night_sweats',
        'weight_loss',
        'fever',
        'swelling_in_any_part_of_the_body'
    ];

    private readonly symptomScoreWeights: Record<string, number> = {
        coughing_2_weeks_or_more: 2,
        night_sweats: 1,
        weight_loss: 1,
        fever: 1,
        swelling_in_any_part_of_the_body: 1
    };

    private requiredRadioGroups() {
        return cy.get('form', { timeout: this.timeout }).first().find(this.requiredRadioGroupSelector);
    }

    private enterDate(fieldId: string, date: Date) {
        const dateParts: Record<string, string> = {
            day: String(date.getDate()).padStart(2, '0'),
            month: String(date.getMonth() + 1).padStart(2, '0'),
            year: String(date.getFullYear())
        };

        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .within(() => {
                Object.entries(dateParts).forEach(([type, value]) => {
                    cy.get(`[data-type="${type}"]`, { timeout: this.timeout })
                        .click()
                        .type(value);
                });
            });
    }

    private selectAnswer($fieldset: JQuery<HTMLElement>, answer: Answer) {
        const label = [...$fieldset[0].querySelectorAll('label')]
            .find((candidate) => candidate.textContent?.trim() === answer);

        expect(label?.control, `${$fieldset.find('legend').first().text().trim()} ${answer} option`).to.exist;
        cy.wrap(label!.control, { log: false }).check({ force: true });
    }

    private selectQuestionAnswer(question: string, answer: Answer) {
        return cy.get('form', { timeout: this.timeout })
            .first()
            .contains('legend', question, { timeout: this.timeout })
            .closest('fieldset')
            .then(($fieldset) => this.selectAnswer($fieldset, answer));
    }

    verifyFormContract() {
        this.requiredRadioGroups()
            .should('have.length', this.requiredRadioGroupNames.length)
            .each(($requiredMarker) => {
                const $fieldset = $requiredMarker.closest('fieldset');
                const fieldLabel = $requiredMarker.closest('legend').text().trim();

                cy.wrap($fieldset, { log: false })
                    .find('input[type="radio"]')
                    .should('have.length', 2)
                    .then(($options) => {
                        const optionLabels = [...$options].map((option) => {
                            return option.ownerDocument
                                .querySelector(`label[for="${option.id}"]`)
                                ?.textContent?.trim();
                        });

                        expect(optionLabels, `${fieldLabel} options`).to.have.members(['Yes', 'No']);
                    });
            })
            .then(($requiredMarkers) => {
                const fieldNames = [...$requiredMarkers].map(($marker) => {
                    const fieldset = $marker.closest('fieldset');
                    return fieldset?.querySelector('input[type="radio"]')?.getAttribute('name');
                });

                expect(fieldNames, 'required TB radio groups').to.have.members(this.requiredRadioGroupNames);
            });

        cy.get('input[name="total_score"]', { timeout: this.timeout }).should(($score) => {
            expect($score).to.have.attr('readonly');
            expect($score).to.have.attr('type', 'number');
            expect($score).to.have.attr('min', '0');
            expect($score).to.have.attr('max', '6');
        });
    }

    completeNegativeScreening() {
        this.requiredRadioGroups()
            .should('have.length', this.requiredRadioGroupNames.length)
            .each(($requiredMarker) => {
                this.selectAnswer($requiredMarker.closest('fieldset'), 'No');
            });

        cy.get('#date_tb_treatment_was_started').should('not.exist');
        cy.get('input[name="total_score"]', { timeout: this.timeout }).should('have.value', '0');
    }

    completeMixedScreening() {
        let expectedScore = 0;

        this.requiredRadioGroups()
            .should('have.length', this.requiredRadioGroupNames.length)
            .each(($requiredMarker) => {
                const fieldset = $requiredMarker.closest('fieldset')[0];
                const fieldName = fieldset.querySelector('input[type="radio"]')?.getAttribute('name') ?? '';
                const weight = this.symptomScoreWeights[fieldName] ?? 0;
                const answer: Answer = fieldName === 'coughing_2_weeks_or_more' ? 'Yes' : 'No';

                this.selectAnswer($requiredMarker.closest('fieldset'), answer);
                expectedScore += answer === 'Yes' ? weight : 0;
            })
            .then(() => {
                expect(expectedScore, 'mixed screening must score above zero').to.be.greaterThan(0);
                cy.get('input[name="total_score"]', { timeout: this.timeout })
                    .should('have.value', String(expectedScore));
            });
    }

    verifyPreviousTreatmentDateToggle() {
        this.selectQuestionAnswer('Previously Treated for TB', 'Yes');
        cy.get('#date_tb_treatment_was_started', { timeout: this.timeout })
            .should('be.visible');
        cy.get('[data-testid="date_tb_treatment_was_started-label"] [title="Required"]', {
            timeout: this.timeout
        }).should('exist');

        this.selectQuestionAnswer('Previously Treated for TB', 'No');
        cy.get('#date_tb_treatment_was_started').should('not.exist');
    }

    saveCompleteNegativeScreening() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTbScreening');
        this.completeNegativeScreening();

        this.enterDate('date_the_screening_was_conducted', new Date());
        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('No diagnostic abnormality');
        cy.get('#observation', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated negative TB screening');

        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveTbScreening', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            expect(request.body.obs, 'submitted TB observations').to.be.an('array').and.not.be.empty;
            expect(request.body.obs.some((observation: { value?: unknown }) => observation.value === 0)).to.equal(true);
            expect(JSON.stringify(request.body)).to.contain('No diagnostic abnormality');
            expect(JSON.stringify(request.body)).to.contain('Automated negative TB screening');
        });
    }

    savePreviouslyTreatedScreening() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTreatedTbScreening');
        const treatmentDate = new Date();
        treatmentDate.setDate(treatmentDate.getDate() - 2);
        this.selectQuestionAnswer('Contact of TB Patient', 'No');
        this.selectQuestionAnswer('Previously Treated for TB', 'Yes');
        this.enterDate('date_tb_treatment_was_started', treatmentDate);
        this.requiredRadioGroupNames
            .filter((fieldName) => !['contact_of_tb_patient', 'previously_treated_for_tb'].includes(fieldName))
            .forEach((fieldName) => {
                cy.get(`input[name="${fieldName}"][id$="-No"]`, { timeout: this.timeout })
                    .scrollIntoView()
                    .check({ force: true });
                cy.get(`input[name="${fieldName}"][id$="-No"]`, { timeout: this.timeout })
                    .should('be.checked');
            });
        cy.get('input[name="total_score"]', { timeout: this.timeout }).should('have.value', '0');
        this.enterDate('date_the_screening_was_conducted', new Date());

        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('No diagnostic abnormality');
        cy.get('#observation', { timeout: this.timeout })
            .scrollIntoView()
            .clear()
            .type('Automated treated TB screening');

        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveTreatedTbScreening', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            expect(request.body.obs, 'submitted treated TB observations').to.be.an('array').and.not.be.empty;
            expect(JSON.stringify(request.body)).to.contain(
                `${treatmentDate.getFullYear()}-${String(treatmentDate.getMonth() + 1).padStart(2, '0')}-${String(
                    treatmentDate.getDate()
                ).padStart(2, '0')}`
            );
        });
    }

    waitForChartToLoad() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
    }

    openClinicalForms() {
        this.waitForChartToLoad();
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.timeout }).click();
    }

    selectForm(formName: string) {
        cy.contains('a.cds--link', formName, { timeout: this.timeout }).click();
    }
}

export default TbScreeningFormPage;
