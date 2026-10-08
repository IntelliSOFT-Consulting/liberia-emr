import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import FamilyPlanningFormPage from '../pages/familyPlanningForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const familyPlanningForm = new FamilyPlanningFormPage();

const registerPatientWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName(),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(16, 35),
        phoneNumber: liberiaPhoneNumber()
    });
    registrationPage.clickRegisterPatient();
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
};

describe('Family Planning form', () => {
    beforeEach(() => {
        loginWithSession();
        registerPatientWithVisit();
        familyPlanningForm.openClinicalForms();
        familyPlanningForm.selectForm();
    });

    // Not yet written: should assert the initial form state (default-visible sections and
    // questions, hidden conditional fields, required markers) before any answer is given.
    it.skip('validates the initial Family Planning form contract', () => {});

    it('blocks saving for each independently missing required answer', () => {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');

        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.selectPurposeForCommodities();
        familyPlanningForm.verifyRequiredFieldBlocksSave('familyPlanningClientType');

        familyPlanningForm.reopenForm();
        familyPlanningForm.selectClientType('New Family Planning Client');
        cy.get('input[id^="purposeOfVisit-"]').should('not.exist');
        familyPlanningForm.verifyRequiredFieldBlocksSave('counsellingDone');

        familyPlanningForm.reopenForm();
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyEmptyPurposeOfVisitBlocksSave();
    });

    it('hides downstream fields and saves when counselling is not done', () => {
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('No');
        familyPlanningForm.verifyCounsellingNoHidesDownstreamFields();
        familyPlanningForm.saveAndVerifyCounsellingNo('New Family Planning Client');

        familyPlanningForm.reopenForm();
        familyPlanningForm.selectClientType('Continuing Family Planning Client');
        familyPlanningForm.selectCounsellingDone('No');
        familyPlanningForm.verifyCounsellingNoHidesDownstreamFields();
        familyPlanningForm.saveAndVerifyCounsellingNo('Continuing Family Planning Client');
    });

    it('shows core fields for counselling Yes and blocks saving without purpose', () => {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');

        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyCounsellingYesShowsCoreFields();
        familyPlanningForm.verifyEmptyPurposeOfVisitBlocksSave();
    });

    it('gates method-specific sections by chosen and dispensed method', () => {
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyLamIsNotADispensedOption();
        familyPlanningForm.verifyChosenMethodSectionGates();
        familyPlanningForm.verifyDispensedImplantOpensImplantSections();
    });

    it('reveals implant sections when implants are dispensed only, and Pregnancy only once chosen', () => {
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyImplantGatesWithoutChosenMethod();
    });

    it('submits a fully completed implant visit and persists every answered field', () => {
        familyPlanningForm.completeAndSubmitImplantVisit();
    });
});

describe('Family Planning form clinical decision support (one shared patient)', () => {
    let patientChartUrl: string;

    before(() => {
        loginWithSession();
        registerPatientWithVisit();
        cy.url().then((url) => {
            patientChartUrl = url;
        });
    });

    beforeEach(() => {
        loginWithSession();
        cy.visit(patientChartUrl);
        familyPlanningForm.openClinicalForms();
        familyPlanningForm.selectForm();
        familyPlanningForm.startCounselledVisit();
    });

    it('requires a past or present insertion date when an implant is inserted', () => {
        familyPlanningForm.verifyImplantInsertionDateRules();
    });

    it('ranks implant screening warnings and withholds clearance until all four are No', () => {
        familyPlanningForm.verifyImplantScreeningCombinations();
    });

    it('shows method-specific guidance after a negative pregnancy test with amenorrhea', () => {
        familyPlanningForm.verifyNegativePregnancyTestGuidance();
    });

    it('offers emergency contraception only within five days and rejects invalid day counts', () => {
        familyPlanningForm.verifyEmergencyContraceptionThresholds();
    });

    it('calculates a read-only repeat pregnancy test date and drops it when no longer applicable', () => {
        familyPlanningForm.verifyRepeatPregnancyTestDate();
    });

    it('evaluates LAM eligibility across amenorrhea, breastfeeding and six-month boundaries', () => {
        familyPlanningForm.verifyLamEligibilityCombinations();
    });
});
