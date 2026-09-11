type DateParts = { day: string; month: string; year: string };

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

    fillForm(data: {
        contactOfTbPatient: 'Yes' | 'No';
        previouslyTreatedForTb: 'Yes' | 'No';
        coughing2WeeksOrMoreScore: number;
        nightSweatsScore: number;
        weightLossScore: number;
        feverScore: number;
        swellingScore: number;
        dateScreeningConducted: DateParts;
        sputumTestResult: string;
        dateTbTreatmentStarted?: DateParts;
        observation?: string;
    }) {
        cy.get(`#contact_of_tb_patient-${data.contactOfTbPatient}`, { timeout: 20000 }).check({ force: true });
        cy.get(`#previously_treated_for_tb-${data.previouslyTreatedForTb}`, { timeout: 20000 }).check({ force: true });

        cy.get('#coughing_2_weeks_or_more_score', { timeout: 20000 }).clear().type(String(data.coughing2WeeksOrMoreScore));
        cy.get('#night_sweats_score', { timeout: 20000 }).clear().type(String(data.nightSweatsScore));
        cy.get('#weight_loss_score', { timeout: 20000 }).clear().type(String(data.weightLossScore));
        cy.get('#fever_score', { timeout: 20000 }).clear().type(String(data.feverScore));
        cy.get('#swelling_in_any_part_of_the_body_score', { timeout: 20000 }).clear().type(String(data.swellingScore));

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
