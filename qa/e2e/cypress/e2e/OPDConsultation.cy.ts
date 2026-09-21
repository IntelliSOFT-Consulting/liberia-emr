import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';
import OpdConsultationFormPage from '../pages/opdConsultationForm';

describe('OPD Consultation form', () => {
    const visitPage = new VisitPage();
    const opdConsultationForm = new OpdConsultationFormPage();

    beforeEach(() => {
        loginWithSession();
        visitPage.registerPatient();
        visitPage.startVisit();
        opdConsultationForm.openClinicalForms();
        opdConsultationForm.selectForm();
    });

    it('opens with the expected contract', () => {
        opdConsultationForm.verifyFormContract();
    });

    it('validates required fields before allowing the form to proceed', () => {
        opdConsultationForm.verifyRequiredFieldValidation();
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
});