type DateParts = { day: string; month: string; year: string };

type YesNo = 'Yes' | 'No';

type TbScreeningFormData = {
    contactOfTbPatient: YesNo;
    previouslyTreatedForTb: YesNo;
    coughing2WeeksOrMore: YesNo;
    nightSweats: YesNo;
    weightLoss: YesNo;
    fever: YesNo;
    swelling: YesNo;
    dateScreeningConducted: DateParts;
    sputumTestResult: string;
    dateTbTreatmentStarted?: DateParts;
    observation?: string;
};

class TbScreeningFormPage {
    constructor(private readonly timeout = 20000) {}

    // The chart's dashboard slot must render before the forms icon/list can be interacted with reliably
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

    private fillDateField(fieldId: string, date: DateParts) {
        cy.get(`#${fieldId} [data-type="day"]`, { timeout: this.timeout }).click().type(date.day);
        cy.get(`#${fieldId} [data-type="month"]`, { timeout: this.timeout }).click().type(date.month);
        cy.get(`#${fieldId} [data-type="year"]`, { timeout: this.timeout }).click().type(date.year);
    }

    private selectYesNoField(fieldId: string, answer: YesNo) {
        cy.get(`#${fieldId}-${answer}`, { timeout: this.timeout }).check({ force: true });
    }

    private fillSymptomField(fieldId: string, answer: YesNo, positiveScore: number) {
        const scoreSelector = `#${fieldId}_score`;
        const yesSelector = `#${fieldId}-Yes`;
        const score = answer === 'Yes' ? positiveScore : 0;

        cy.get(`${scoreSelector}, ${yesSelector}`, { timeout: this.timeout })
            .then((controls) => {
                const hasScoreControl = controls.filter(scoreSelector).length > 0;
                const hasYesNoControl = controls.filter(yesSelector).length > 0;

                if (hasScoreControl && hasYesNoControl) {
                    throw new Error(`Ambiguous TB screening field controls rendered: ${fieldId}`);
                }

                if (hasScoreControl) {
                    cy.get(scoreSelector, { timeout: this.timeout }).clear().type(String(score));
                    return;
                }

                this.selectYesNoField(fieldId, answer);
            });
    }

    fillForm(data: TbScreeningFormData) {
        this.selectYesNoField('contact_of_tb_patient', data.contactOfTbPatient);
        this.selectYesNoField('previously_treated_for_tb', data.previouslyTreatedForTb);

        this.fillSymptomField('coughing_2_weeks_or_more', data.coughing2WeeksOrMore, 2);
        this.fillSymptomField('night_sweats', data.nightSweats, 1);
        this.fillSymptomField('weight_loss', data.weightLoss, 1);
        this.fillSymptomField('fever', data.fever, 1);
        this.fillSymptomField('swelling_in_any_part_of_the_body', data.swelling, 1);

        this.fillDateField('date_the_screening_was_conducted', data.dateScreeningConducted);

        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation', { timeout: this.timeout })
            .clear()
            .type(data.sputumTestResult);

        if (data.dateTbTreatmentStarted) {
            this.fillDateField('date_tb_treatment_was_started', data.dateTbTreatmentStarted);
        }

        if (data.observation) {
            cy.get('#observation', { timeout: this.timeout }).clear().type(data.observation);
        }
    }

    submitForm() {
        cy.contains('button', 'Save', { timeout: this.timeout }).should('be.enabled').click();
    }
}

export default TbScreeningFormPage;
