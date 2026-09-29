import { loginWithSession } from '../support/session';
import { randomAdultBirthdateParts } from '../support/faker';
import VisitPage from '../pages/visit';
import TriageFormPage from '../pages/triageForm';

describe('Child Triage Assessment form', () => {
    const visitPage = new VisitPage();
    const triageForm = new TriageFormPage();

    beforeEach(() => {
        loginWithSession();
        visitPage.registerPatient({ birthdate: randomAdultBirthdateParts(5, 10) });
        visitPage.startVisit();
        triageForm.openClinicalForms();
        triageForm.selectForm();
    });

    it('opens with the child-specific sections and fields', () => {
        triageForm.verifyChildFormContract();
    });

    it('requires Ebola screening before saving', () => {
        triageForm.verifyEbolaScreeningRequired();
    });

    it('requires a child triage category before saving', () => {
        triageForm.verifyChildCategoryRequired();
    });

    it('offers the three child triage categories', () => {
        triageForm.verifyChildCategoryOptions();
    });

    it('validates the numeric limits of child vitals', () => {
        triageForm.verifyNumericLimits();
    });

    it('rejects decimals in integer-only vitals and accepts them in decimal vitals', () => {
        triageForm.verifyNumericPrecision();
    });

    it('shows clinical warnings without blocking a complete assessment', () => {
        triageForm.verifyClinicalWarningsAllowSave();
    });

    it('omits previously selected signs after changing the child category', () => {
        triageForm.verifyHiddenSignsAreNotSubmitted();
    });

    it('saves a Non-urgent child assessment with screening and vitals', () => {
        triageForm.verifySavedAssessment();
    });

    it('saves an Urgent child assessment with its selected sign', () => {
        triageForm.verifySavedAssessment('Urgent Priority');
    });

    it('saves an Emergency child assessment with Positive screening and its selected sign', () => {
        triageForm.verifySavedAssessment('Emergency Priority', 'Positive');
    });
});