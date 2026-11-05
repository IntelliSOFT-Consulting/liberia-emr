import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';
import OpdConsultationFormPage from '../pages/opdConsultationForm';
import { randomAdultBirthdateParts } from '../support/faker';

describe('OPD Consultation form', () => {
    const visitPage = new VisitPage();
    const opdConsultationForm = new OpdConsultationFormPage();

    beforeEach(() => {
        loginWithSession();
        visitPage.registerPatient({ birthdate: randomAdultBirthdateParts(25, 35) });
        visitPage.startVisit();
        opdConsultationForm.openClinicalForms();
        opdConsultationForm.selectForm();
    });

    it('opens with the expected contract', () => {
        opdConsultationForm.verifyFormContract();
        opdConsultationForm.verifyPatientCategory('First Visit');
    });

    it('allows the automatically selected patient category to be overridden', () => {
        opdConsultationForm.verifyPatientCategoryOverride();
    });

    it('allows clinician selection only for a backdated encounter while keeping location read-only', () => {
        opdConsultationForm.verifyBackdatedClinicianSelection();
    });

    it('validates the vitals input contract', () => {
        opdConsultationForm.verifyVitalsInputContract();
    });

    it('calculates BMI from weight and height for adult patients', () => {
        opdConsultationForm.verifyBmiCalculation();
    });

    it('shows validation errors for invalid vitals', () => {
        opdConsultationForm.verifyVitalsValidationErrors();
    });

    it('toggles general examination clinical findings from Yes and No answers', () => {
        opdConsultationForm.verifyGeneralExaminationRadioGroups();
    });

    it('toggles systemic examination findings from abnormal and normal answers', () => {
        opdConsultationForm.verifySystemicExaminationRadioGroups();
    });

    it('shows follow-up date only when follow-up is required', () => {
        opdConsultationForm.verifyFollowupConditionalDate();
    });

    it('shows referral fields only for referred disposition and validates destination', () => {
        opdConsultationForm.verifyOutcomeDispositionReferralFields();
    });

    it('saves with automatic encounter context and defaults the next consultation to follow-up', () => {
        opdConsultationForm.fillCompleteValidFormAndSave();
        cy.reload();
        opdConsultationForm.openClinicalForms();
        opdConsultationForm.selectForm();
        opdConsultationForm.verifyPatientCategory('Follow-up Visit');
        opdConsultationForm.verifyAutomaticEncounterContext();
    });
});