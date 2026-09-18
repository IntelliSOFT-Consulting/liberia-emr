type DateParts = { day: string; month: string; year: string };

type YesNo = 'Yes' | 'No';

type TbScreeningFormData = {
    contactOfTbPatient: YesNo;
    previouslyTreatedForTb: YesNo;
    coughing2WeeksOrMoreScore: number;
    nightSweatsScore: number;
    weightLossScore: number;
    feverScore: number;
    swellingScore: number;
    coughing2WeeksOrMore?: YesNo;
    nightSweats?: YesNo;
    weightLoss?: YesNo;
    fever?: YesNo;
    swelling?: YesNo;
    dateScreeningConducted: DateParts;
    sputumTestResult: string;
    dateTbTreatmentStarted?: DateParts;
    observation?: string;
};

class TbScreeningFormPage {
    // The chart's dashboard slot must render before the forms icon/list can be interacted with reliably
    waitForChartToLoad() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
            .should('be.visible');
    }

    openClinicalForms() {
        this.waitForChartToLoad();
        cy.get('button[aria-label="Clinical forms"]', { timeout: 20000 }).click();
    }

    selectForm(formName: string) {
        cy.contains('a.cds--link', formName, { timeout: 20000 }).click();
    }

    private fillDateField(fieldId: string, date: DateParts) {
        cy.get(`#${fieldId} [data-type="day"]`, { timeout: 20000 }).click().type(date.day);
        cy.get(`#${fieldId} [data-type="month"]`, { timeout: 20000 }).click().type(date.month);
        cy.get(`#${fieldId} [data-type="year"]`, { timeout: 20000 }).click().type(date.year);
    }

    private selectYesNoField(fieldId: string, answer: YesNo) {
        cy.get(`#${fieldId}-${answer}`, { timeout: 20000 }).check({ force: true });
    }

    private fillScoreField(fieldId: string, score: number, answer?: YesNo) {
        const scoreSelector = `#${fieldId}_score`;
        const yesSelector = `#${fieldId}-Yes`;

        cy.get('body', { timeout: 20000 })
            .should((body) => {
                expect(
                    body.find(scoreSelector).length > 0 || body.find(yesSelector).length > 0,
                    `expected ${fieldId} score or yes/no control`
                ).to.equal(true);
            })
            .then((body) => {
                if (body.find(scoreSelector).length > 0) {
                    cy.get(scoreSelector, { timeout: 20000 }).clear().type(String(score));
                    return;
                }

                if (!answer) {
                    throw new Error(`Missing yes/no answer for TB screening field: ${fieldId}`);
                }

                this.selectYesNoField(fieldId, answer);
            });
    }

    fillForm(data: TbScreeningFormData) {
        this.selectYesNoField('contact_of_tb_patient', data.contactOfTbPatient);
        this.selectYesNoField('previously_treated_for_tb', data.previouslyTreatedForTb);

        this.fillScoreField('coughing_2_weeks_or_more', data.coughing2WeeksOrMoreScore, data.coughing2WeeksOrMore);
        this.fillScoreField('night_sweats', data.nightSweatsScore, data.nightSweats);
        this.fillScoreField('weight_loss', data.weightLossScore, data.weightLoss);
        this.fillScoreField('fever', data.feverScore, data.fever);
        this.fillScoreField('swelling_in_any_part_of_the_body', data.swellingScore, data.swelling);

        this.fillDateField('date_the_screening_was_conducted', data.dateScreeningConducted);

        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation', { timeout: 20000 })
            .clear()
            .type(data.sputumTestResult);

        if (data.dateTbTreatmentStarted) {
            this.fillDateField('date_tb_treatment_was_started', data.dateTbTreatmentStarted);
        }

        if (data.observation) {
            cy.get('#observation', { timeout: 20000 }).clear().type(data.observation);
        }
    }

    submitForm() {
        cy.contains('button', 'Save', { timeout: 20000 }).should('be.enabled').click();
    }
}

export default TbScreeningFormPage;
