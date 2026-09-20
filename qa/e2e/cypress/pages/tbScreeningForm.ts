type DateParts = { day: string; month: string; year: string };

type YesNo = 'Yes' | 'No';

// Mirrors tb_screening-national.json: every symptom is a Yes/No coded question,
// and Total Score is derived from them rather than typed in.
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
    observation: string;
    dateTbTreatmentStarted?: DateParts;
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

    private selectYesNo(fieldId: string, answer: YesNo) {
        cy.get(`#${fieldId}-${answer}`, { timeout: 20000 }).check({ force: true });
    }

    fillForm(data: TbScreeningFormData) {
        this.selectYesNo('contact_of_tb_patient', data.contactOfTbPatient);
        this.selectYesNo('previously_treated_for_tb', data.previouslyTreatedForTb);

        // Lives inside the previously_treated_for_tb obsGroup and is hidden — and only
        // then conditionally required — unless the answer above is Yes.
        if (data.previouslyTreatedForTb === 'Yes' && data.dateTbTreatmentStarted) {
            this.fillDateField('date_tb_treatment_was_started', data.dateTbTreatmentStarted);
        }

        this.selectYesNo('coughing_2_weeks_or_more', data.coughing2WeeksOrMore);
        this.selectYesNo('night_sweats', data.nightSweats);
        this.selectYesNo('weight_loss', data.weightLoss);
        this.selectYesNo('fever', data.fever);
        this.selectYesNo('swelling_in_any_part_of_the_body', data.swelling);

        this.fillDateField('date_the_screening_was_conducted', data.dateScreeningConducted);

        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation', { timeout: 20000 })
            .clear()
            .type(data.sputumTestResult);

        cy.get('#observation', { timeout: 20000 }).clear().type(data.observation);
    }

    // Total Score is read-only and recalculated by the form engine as symptoms are answered:
    // coughing 2 weeks or more scores 2, every other Yes scores 1.
    expectTotalScore(expected: number) {
        cy.get('#total_score', { timeout: 20000 }).should('have.value', String(expected));
    }

    expectTreatmentStartDateHidden() {
        cy.get('#date_tb_treatment_was_started').should('not.exist');
    }

    submitForm() {
        cy.contains('button', 'Save', { timeout: 20000 }).should('be.enabled').click();
    }
}

export default TbScreeningFormPage;
