import TbScreeningFormPage from '../pages/tbScreeningForm';

const buildDateField = (id: string) => `
    <div id="${id}">
        <input data-type="day" />
        <input data-type="month" />
        <input data-type="year" />
    </div>
`;

const buildYesNoField = (id: string) => `
    <input id="${id}-Yes" type="radio" name="${id}" value="Yes" />
    <input id="${id}-No" type="radio" name="${id}" value="No" />
`;

const commonFields = `
    ${buildYesNoField('contact_of_tb_patient')}
    ${buildYesNoField('previously_treated_for_tb')}
    ${buildDateField('date_the_screening_was_conducted')}
    ${buildDateField('date_tb_treatment_was_started')}
    <input id="result_of_the_sputum_test_or_other_diagnostic_evaluation" />
    <textarea id="observation"></textarea>
`;

const buildLegacyScoreLayout = () => `
    <html>
        <body>
            ${commonFields}
            <input id="coughing_2_weeks_or_more_score" />
            <input id="night_sweats_score" />
            <input id="weight_loss_score" />
            <input id="fever_score" />
            <input id="swelling_in_any_part_of_the_body_score" />
        </body>
    </html>
`;

const buildYesNoLayout = () => `
    <html>
        <body>
            ${commonFields}
            ${buildYesNoField('coughing_2_weeks_or_more')}
            ${buildYesNoField('night_sweats')}
            ${buildYesNoField('weight_loss')}
            ${buildYesNoField('fever')}
            ${buildYesNoField('swelling_in_any_part_of_the_body')}
        </body>
    </html>
`;

const buildLayoutMissingFeverControl = () => `
    <html>
        <body>
            ${commonFields}
            ${buildYesNoField('coughing_2_weeks_or_more')}
            ${buildYesNoField('night_sweats')}
            ${buildYesNoField('weight_loss')}
            ${buildYesNoField('swelling_in_any_part_of_the_body')}
        </body>
    </html>
`;

const buildAmbiguousCoughControlLayout = () => `
    <html>
        <body>
            ${commonFields}
            <input id="coughing_2_weeks_or_more_score" />
            ${buildYesNoField('coughing_2_weeks_or_more')}
            ${buildYesNoField('night_sweats')}
            ${buildYesNoField('weight_loss')}
            ${buildYesNoField('fever')}
            ${buildYesNoField('swelling_in_any_part_of_the_body')}
        </body>
    </html>
`;

const mountForm = (markup: string) => {
    cy.visit('about:blank');
    cy.document().then((doc) => {
        doc.open();
        doc.write(markup);
        doc.close();
    });
};

describe('TB Screening form page object', () => {
    const page = new TbScreeningFormPage();

    it('fills the legacy score-based layout', () => {
        mountForm(buildLegacyScoreLayout());

        page.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'Yes',
            fever: 'No',
            swelling: 'Yes',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Negative',
            observation: 'Legacy layout'
        });

        cy.get('#coughing_2_weeks_or_more_score').should('have.value', '2');
        cy.get('#night_sweats_score').should('have.value', '1');
        cy.get('#weight_loss_score').should('have.value', '1');
        cy.get('#fever_score').should('have.value', '0');
        cy.get('#swelling_in_any_part_of_the_body_score').should('have.value', '1');
        cy.get('#contact_of_tb_patient-No').should('be.checked');
        cy.get('#previously_treated_for_tb-No').should('be.checked');
        cy.get('#date_the_screening_was_conducted [data-type="day"]').should('have.value', '01');
        cy.get('#date_the_screening_was_conducted [data-type="month"]').should('have.value', '01');
        cy.get('#date_the_screening_was_conducted [data-type="year"]').should('have.value', '2025');
        cy.get('#date_tb_treatment_was_started [data-type="day"]').should('have.value', '');
        cy.get('#date_tb_treatment_was_started [data-type="month"]').should('have.value', '');
        cy.get('#date_tb_treatment_was_started [data-type="year"]').should('have.value', '');
        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation').should('have.value', 'Negative');
        cy.get('#observation').should('have.value', 'Legacy layout');
    });

    it('fills the yes/no symptom layout', () => {
        mountForm(buildYesNoLayout());

        page.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'Yes',
            fever: 'No',
            swelling: 'Yes',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            dateTbTreatmentStarted: { day: '02', month: '01', year: '2025' },
            sputumTestResult: 'Negative',
            observation: 'Yes/no layout'
        });

        cy.get('#coughing_2_weeks_or_more-Yes').should('be.checked');
        cy.get('#night_sweats-Yes').should('be.checked');
        cy.get('#weight_loss-Yes').should('be.checked');
        cy.get('#fever-No').should('be.checked');
        cy.get('#swelling_in_any_part_of_the_body-Yes').should('be.checked');
        cy.get('#contact_of_tb_patient-No').should('be.checked');
        cy.get('#previously_treated_for_tb-No').should('be.checked');
        cy.get('#date_the_screening_was_conducted [data-type="day"]').should('have.value', '01');
        cy.get('#date_the_screening_was_conducted [data-type="month"]').should('have.value', '01');
        cy.get('#date_the_screening_was_conducted [data-type="year"]').should('have.value', '2025');
        cy.get('#date_tb_treatment_was_started [data-type="day"]').should('have.value', '02');
        cy.get('#date_tb_treatment_was_started [data-type="month"]').should('have.value', '01');
        cy.get('#date_tb_treatment_was_started [data-type="year"]').should('have.value', '2025');
        cy.get('#result_of_the_sputum_test_or_other_diagnostic_evaluation').should('have.value', 'Negative');
        cy.get('#observation').should('have.value', 'Yes/no layout');
    });

    it('fails when neither symptom control variant is rendered', () => {
        const fastPage = new TbScreeningFormPage(100);
        let failureMessage = '';

        mountForm(buildLayoutMissingFeverControl());

        Cypress.once('fail', (error) => {
            failureMessage = error.message;
            expect(error.message).to.contain('expected fever score or yes/no control');
            return false;
        });

        fastPage.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'Yes',
            fever: 'No',
            swelling: 'Yes',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Negative'
        });

        cy.then(() => {
            expect(failureMessage).to.contain('expected fever score or yes/no control');
        });
    });
    it('fails when both symptom control variants are rendered', () => {
        const fastPage = new TbScreeningFormPage(100);
        let failureMessage = '';

        mountForm(buildAmbiguousCoughControlLayout());

        Cypress.once('fail', (error) => {
            failureMessage = error.message;
            expect(error.message).to.contain('Ambiguous TB screening field controls rendered: coughing_2_weeks_or_more');
            return false;
        });

        fastPage.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'Yes',
            fever: 'No',
            swelling: 'Yes',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Negative'
        });

        cy.then(() => {
            expect(failureMessage).to.contain('Ambiguous TB screening field controls rendered: coughing_2_weeks_or_more');
        });
    });

});
