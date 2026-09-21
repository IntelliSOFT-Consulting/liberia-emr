type Answer = 'Yes' | 'No';

class TbScreeningFormPage {
    constructor(private readonly timeout = 20000) {}

    private readonly requiredRadioGroupSelector = 'fieldset > legend [title="Required"]';

    private readonly symptomScoreWeights: Record<string, number> = {
        coughing_2_weeks_or_more: 2,
        night_sweats: 1,
        weight_loss: 1,
        fever: 1,
        swelling_in_any_part_of_the_body: 1
    };

    private requiredRadioGroups() {
        return cy.get(this.requiredRadioGroupSelector, { timeout: this.timeout });
    }

    private selectAnswer($fieldset: JQuery<HTMLElement>, answer: Answer) {
        const label = [...$fieldset[0].querySelectorAll('label')]
            .find((candidate) => candidate.textContent?.trim() === answer);

        expect(label?.control, `${$fieldset.find('legend').first().text().trim()} ${answer} option`).to.exist;
        cy.wrap(label!.control, { log: false }).check({ force: true });
    }

    private selectQuestionAnswer(question: string, answer: Answer) {
        return cy.contains('legend', question, { timeout: this.timeout })
            .closest('fieldset')
            .then(($fieldset) => this.selectAnswer($fieldset, answer));
    }

    verifyFormContract() {
        this.requiredRadioGroups()
            .should('have.length.greaterThan', 0)
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
            .should('have.length.greaterThan', 0)
            .each(($requiredMarker) => {
                this.selectAnswer($requiredMarker.closest('fieldset'), 'No');
            });

        cy.get('#date_tb_treatment_was_started').should('not.exist');
        cy.get('input[name="total_score"]', { timeout: this.timeout }).should('have.value', '0');
    }

    completeMixedScreening() {
        let expectedScore = 0;
        let symptomIndex = 0;

        this.requiredRadioGroups()
            .should('have.length.greaterThan', 0)
            .each(($requiredMarker) => {
                const fieldset = $requiredMarker.closest('fieldset')[0];
                const fieldName = fieldset.querySelector('input[type="radio"]')?.getAttribute('name') ?? '';
                const weight = this.symptomScoreWeights[fieldName];
                const answer = weight && symptomIndex++ % 2 === 0 ? 'Yes' : 'No';

                this.selectAnswer($requiredMarker.closest('fieldset'), answer);
                expectedScore += answer === 'Yes' ? weight : 0;
            })
            .then(() => {
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

    verifyRequiredFieldsAndSave() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTbScreening');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.contains('Field is mandatory', { timeout: this.timeout }).should('exist');

        this.completeNegativeScreening();

        const today = new Date();
        const dateParts: Record<string, string> = {
            day: String(today.getDate()).padStart(2, '0'),
            month: String(today.getMonth() + 1).padStart(2, '0'),
            year: String(today.getFullYear())
        };

        cy.get('[title="Required"]', { timeout: this.timeout }).each(($requiredMarker) => {
            if ($requiredMarker.closest('legend').length) {
                return;
            }

            const $container = $requiredMarker.closest('.cds--date-picker, .cds--form-item');
            const $dateParts = $container.find('[data-type="day"], [data-type="month"], [data-type="year"]');

            if ($dateParts.length) {
                cy.wrap($dateParts, { log: false }).each(($part) => {
                    const type = $part.attr('data-type') ?? '';
                    cy.wrap($part, { log: false }).click().type(dateParts[type]);
                });
                return;
            }

            cy.wrap($container, { log: false })
                .find('input:not([type="hidden"]):not([readonly]), textarea')
                .first()
                .clear()
                .type('Automated TB screening');
        });

        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.wait('@saveTbScreening', { timeout: this.timeout }).then(({ response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
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
