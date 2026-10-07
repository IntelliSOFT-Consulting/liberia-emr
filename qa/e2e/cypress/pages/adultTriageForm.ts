import TriageFormPage from './triageForm';

class AdultTriageFormPage extends TriageFormPage {
    verifyAdultWarningsAllowSave() {
        this.enterVitals([
            { id: 'temp', value: '38.1' },
            { id: 'hr', value: '101' },
            { id: 'rr', value: '27' },
            { id: 'sbp', value: '141' },
            { id: 'dbp', value: '91' },
            { id: 'spo2', value: '94' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' },
            { id: 'pain_score', value: '0' }
        ]);

        this.assertWarningsVisible([
            'Temperature is outside the normal range (36–38 °C). Please verify the reading.',
            'Heart Rate is outside the normal range (60–100 bpm). Please verify the reading.',
            'Respiratory Rate is outside the normal range (12–26 breaths/min). Please verify the reading.',
            'Systolic BP is outside the normal range (100–140 mmHg). Please verify the reading.',
            'Diastolic BP is outside the normal range (55–90 mmHg). Please verify the reading.',
            'SpO₂ below 95% — please verify the reading and consider clinical review.'
        ]);

        this.submitAssessment();
        cy.wait('@saveTriage', { timeout: this.timeout }).its('response.statusCode').should('be.oneOf', [200, 201]);
    }

    verifyBmiCalculationAndSave() {
        const adultVitals = [
            { id: 'temp', value: '37.2' },
            { id: 'hr', value: '78' },
            { id: 'rr', value: '18' },
            { id: 'sbp', value: '120' },
            { id: 'dbp', value: '80' },
            { id: 'spo2', value: '98' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' },
            { id: 'pain_score', value: '0' }
        ];
        this.enterVitals(adultVitals);

        cy.get('#bmi', { timeout: this.timeout })
            .should('be.disabled')
            .should(($bmi) => {
                expect(Number.parseFloat(String($bmi.val()))).to.be.closeTo(24.2, 0.1);
            });

        cy.get('#weight').type('{selectall}80').blur();
        cy.get('#bmi').should(($bmi) => {
            expect(Number.parseFloat(String($bmi.val()))).to.be.closeTo(27.7, 0.1);
        });
        cy.get('#weight').type('{selectall}70').blur();
        cy.get('#bmi').should(($bmi) => {
            expect(Number.parseFloat(String($bmi.val()))).to.be.closeTo(24.2, 0.1);
        });

        this.submitAssessment();
        cy.wait('@saveTriage', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath: string; value: number }>;
            const observationFor = (fieldId: string) =>
                observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`);

            adultVitals.forEach(({ id, value }) => {
                expect(observationFor(id)?.value, `saved ${id}`).to.equal(Number(value));
            });
            expect(observationFor('bmi')?.value, 'saved BMI').to.be.closeTo(24.2, 0.1);
            ['ebola_screen', 'triage_category_child', 'red_signs_child', 'yellow_signs_child'].forEach((fieldId) => {
                expect(observationFor(fieldId), `child-only ${fieldId} observation`).to.be.undefined;
            });
        });
    }

    verifyAdultNumericLimits() {
        this.verifyNumericLimits();
        this.verifyNumericFieldLimits([
            { id: 'sbp', min: '0', max: '250', below: '-1', above: '251' },
            { id: 'dbp', min: '0', max: '150', below: '-1', above: '151' },
            { id: 'pain_score', min: '0', max: '10', below: '-1', above: '11' }
        ]);
    }

    verifyDiastolicMustBeBelowSystolic() {
        [
            { id: 'temp', value: '37.2' },
            { id: 'hr', value: '78' },
            { id: 'rr', value: '18' },
            { id: 'sbp', value: '120' },
            { id: 'dbp', value: '120' },
            { id: 'spo2', value: '98' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' },
            { id: 'pain_score', value: '0' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(value).blur();
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();
        cy.contains('Diastolic pressure cannot be greater than or equal to systolic pressure', {
            timeout: this.timeout
        }).scrollIntoView().should('be.visible');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyPainScoreRequired() {
        [
            { id: 'temp', value: '37.2' },
            { id: 'hr', value: '78' },
            { id: 'rr', value: '18' },
            { id: 'sbp', value: '120' },
            { id: 'dbp', value: '80' },
            { id: 'spo2', value: '98' },
            { id: 'weight', value: '70' },
            { id: 'height', value: '170' }
        ].forEach(({ id, value }) => {
            cy.get(`#${id}`, { timeout: this.timeout }).scrollIntoView().type(value).blur();
        });

        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveTriage');
        cy.contains('button', 'Save', { timeout: this.timeout }).click();

        cy.get('#pain_score', { timeout: this.timeout }).should('have.attr', 'aria-invalid', 'true');
        cy.get('@saveTriage.all').should('have.length', 0);
    }

    verifyAdultFormContract() {
        cy.contains('p', 'Triage Assessment', { timeout: this.timeout }).should('be.visible');
        cy.contains('.cds--accordion__title', 'Vital Signs', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        ['temp', 'hr', 'rr', 'sbp', 'dbp', 'spo2', 'weight', 'height', 'pain_score'].forEach((fieldId) => {
            cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().should('be.visible');
            cy.get(`[data-testid="${fieldId}-label"] [title="Required"]`).should('exist');
        });

        cy.get('#bmi', { timeout: this.timeout }).scrollIntoView().should('be.visible').and('be.disabled');
        cy.get('#muac', { timeout: this.timeout }).should('be.visible');
        cy.get('[data-testid="muac-label"] [title="Required"]').should('not.exist');

        cy.contains('legend', 'Ebola Screening Result').should('not.exist');
        ['triage_category_child', 'whz', 'red_signs_child', 'yellow_signs_child'].forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"], #${fieldId}`).should('not.exist');
        });
    }
}

export default AdultTriageFormPage;