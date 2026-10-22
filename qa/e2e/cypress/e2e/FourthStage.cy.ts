import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import FourthStageFormPage from '../pages/fourthStageForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const fourthStageForm = new FourthStageFormPage();

const registerMotherWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName('female'),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(18, 40),
        phoneNumber: liberiaPhoneNumber()
    });
    registrationPage.clickRegisterPatient();
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
};

const openFourthStageForm = () => {
    fourthStageForm.openClinicalForms();
    fourthStageForm.selectForm();
};

describe('Fourth Stage vital-sign validation (one shared patient)', { retries: 1 }, () => {
    let patientChartUrl: string;

    before(() => {
        loginWithSession();
        registerMotherWithVisit();
        cy.url().then((url) => {
            patientChartUrl = url;
        });
    });

    beforeEach(() => {
        loginWithSession();
        cy.visit(patientChartUrl);
        openFourthStageForm();
        fourthStageForm.fillRequiredFields();
    });

    const reject = (fieldId: string, value: string, message: string) => {
        fourthStageForm.setNumber(fieldId, value);
        fourthStageForm.verifyFieldInvalid(fieldId, message);
        fourthStageForm.verifyValueRemains(fieldId, value);
        fourthStageForm.verifySaveBlocked();
        fourthStageForm.verifyValueRemains(fieldId, value);
    };

    it('saves systolic blood pressure at the lower bound of 0', () => {
        fourthStageForm.setNumber('bp_sys', '0');
        fourthStageForm.saveAndGetObservations().then((observations) => {
            expect(Number(fourthStageForm.observationValue(observations, 'bp_sys'))).to.equal(0);
        });
    });

    it('rejects systolic blood pressure of 251 on that field and keeps the value', () => {
        reject('bp_sys', '251', FourthStageFormPage.messages.systolicRange);
    });

    it('clears the systolic error when the value is corrected', () => {
        fourthStageForm.setNumber('bp_sys', '251');
        fourthStageForm.verifyFieldInvalid('bp_sys', FourthStageFormPage.messages.systolicRange);
        fourthStageForm.setNumber('bp_sys', '250');
        fourthStageForm.verifyFieldValid('bp_sys', FourthStageFormPage.messages.systolicRange);
        fourthStageForm.verifyValueRemains('bp_sys', '250');
    });

    it('saves diastolic blood pressure at the upper bound of 150', () => {
        fourthStageForm.setNumber('bp_dia', '150');
        fourthStageForm.saveAndGetObservations().then((observations) => {
            expect(Number(fourthStageForm.observationValue(observations, 'bp_dia'))).to.equal(150);
        });
    });

    it('rejects diastolic blood pressure of 151 on that field', () => {
        reject('bp_dia', '151', FourthStageFormPage.messages.diastolicRange);
    });

    it('saves pulse at the lower bound of 0 and the upper bound of 250', () => {
        fourthStageForm.setNumber('pulse', '0');
        fourthStageForm.saveAndGetObservations().then((observations) => {
            expect(Number(fourthStageForm.observationValue(observations, 'pulse'))).to.equal(0);
        });

        cy.visit(patientChartUrl);
        openFourthStageForm();
        fourthStageForm.fillRequiredFields();
        fourthStageForm.setNumber('pulse', '250');
        fourthStageForm.saveAndGetObservations().then((observations) => {
            expect(Number(fourthStageForm.observationValue(observations, 'pulse'))).to.equal(250);
        });
    });

    it('rejects pulse below the range and above the range', () => {
        reject('pulse', '-1', FourthStageFormPage.messages.pulseRange);
        fourthStageForm.setNumber('pulse', '251');
        fourthStageForm.verifyFieldInvalid('pulse', FourthStageFormPage.messages.pulseRange);
        fourthStageForm.verifySaveBlocked();
    });

    it('rejects a decimal on the field that was typed', () => {
        reject('bp_sys', '120.5', FourthStageFormPage.messages.systolicRange);
        fourthStageForm.setNumber('bp_dia', '90.5');
        fourthStageForm.verifyFieldInvalid('bp_dia', FourthStageFormPage.messages.diastolicRange);
        fourthStageForm.setNumber('pulse', '76.5');
        fourthStageForm.verifyFieldInvalid('pulse', FourthStageFormPage.messages.pulseRange);
        fourthStageForm.verifySaveBlocked();
    });

    it('saves systolic 248, diastolic 144 and pulse 76 and closes the form', () => {
        fourthStageForm.setNumber('bp_sys', '248');
        fourthStageForm.setNumber('bp_dia', '144');
        fourthStageForm.setNumber('pulse', '76');
        fourthStageForm.saveAndGetObservations().then((observations) => {
            expect(Number(fourthStageForm.observationValue(observations, 'bp_sys'))).to.equal(248);
            expect(Number(fourthStageForm.observationValue(observations, 'bp_dia'))).to.equal(144);
            expect(Number(fourthStageForm.observationValue(observations, 'pulse'))).to.equal(76);
            expect(fourthStageForm.observationValue(observations, 'observation_time'), 'saved observation time')
                .to.match(/^\d{2}:\d{2}/);
        });
    });
});
