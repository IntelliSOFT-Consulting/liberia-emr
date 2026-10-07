import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import FamilyPlanningFormPage from '../pages/familyPlanningForm';

describe('Family Planning form', () => {
    const registrationPage = new RegistrationPage();
    const visitPage = new VisitPage();
    const familyPlanningForm = new FamilyPlanningFormPage();

    beforeEach(() => {
        loginWithSession();
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
        familyPlanningForm.openClinicalForms();
        familyPlanningForm.selectForm();
    });

    it('validates the initial Family Planning form contract');

    it('FP-02: blocks saving for each independently missing required answer', () => {
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

    it('FP-03/FP-04: hides downstream fields and saves when counselling is not done', () => {
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

    it('FP-05/FP-06: shows core fields for counselling Yes and blocks saving without purpose', () => {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');

        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyCounsellingYesShowsCoreFields();
        familyPlanningForm.verifyEmptyPurposeOfVisitBlocksSave();
    });

    it('FP-11: gates method-specific sections by chosen and dispensed method', () => {
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyLamIsNotADispensedOption();
        familyPlanningForm.verifyChosenMethodSectionGates();
        familyPlanningForm.verifyDispensedImplantOpensImplantSections();
    });

    it('FP-12: reveals implant sections when implants are dispensed only, and Pregnancy only once chosen', () => {
        familyPlanningForm.selectClientType('New Family Planning Client');
        familyPlanningForm.selectCounsellingDone('Yes');
        familyPlanningForm.verifyImplantGatesWithoutChosenMethod();
    });
});
