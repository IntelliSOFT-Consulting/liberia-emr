import { loginWithSession } from '../support/session';
import { enrolInAnc } from '../support/anc-enrolment';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import ANCInitialFormPage from '../pages/ancInitialForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const ancInitialForm = new ANCInitialFormPage();

const registerMotherWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName(),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(16, 35),
        phoneNumber: liberiaPhoneNumber()
    });
    cy.intercept('POST', '**/ws/rest/v1/patient').as('registerAncPatient');
    registrationPage.clickRegisterPatient();
    const registeredPatient = cy.wait('@registerAncPatient').then(({ response }) => {
        expect(response?.statusCode, 'synthetic patient registration').to.equal(201);
        const patientUuid: unknown = response?.body.uuid;
        if (typeof patientUuid !== 'string' || !patientUuid.trim()) {
            throw new Error('Patient registration did not return a patient UUID for ANC enrolment');
        }
        return patientUuid;
    });
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
    return registeredPatient.then((patientUuid) => patientUuid);
};

describe('ANC forms without programme enrolment', () => {
    it('keeps Initial and Follow-up hidden after starting a visit alone', () => {
        loginWithSession();
        registerMotherWithVisit();
        ancInitialForm.openClinicalForms();
        ancInitialForm.verifyAncFormVisibility(false, false);
    });
});

describe('Initial ANC Assessment form', () => {
    beforeEach(() => {
        loginWithSession();
        registerMotherWithVisit().then((patientUuid) => enrolInAnc(patientUuid));
        ancInitialForm.openClinicalForms();
    });

    it('offers Initial but not Follow-up for an enrolled female patient aged 16 to 35', () => {
        ancInitialForm.verifyAncFormVisibility(true, false);
        ancInitialForm.selectForm();
        ancInitialForm.verifyFormContract();
    });

    it('validates consistency across obstetric history fields', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyObstetricHistoryConsistency();
    });

    it('saves an ANC Initial Visit with key obstetric and maternal observations', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifySuccessfulAssessmentSaved();
        ancInitialForm.openClinicalForms();
        ancInitialForm.verifyAncFormVisibility(false, true);
    });

    it('does not save physical exam descriptions after findings are set to Normal', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyPhysicalExamDescriptionsNotSavedWhenNormal();
    });

    it('shows maternal BP warnings without blocking save', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyMaternalBpWarningsAllowSave();
    });

    it('shows the appropriate IPT field and requires a dose for Yes', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyIptConditionalFields();
    });

    it('saves with optional fetal assessment fields blank', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyOptionalFetalFieldsCanBeBlank();
    });

    it('shows warnings for non-vertex presentation and abnormal fetal heart tone', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyFetalAssessmentWarnings();
    });
});