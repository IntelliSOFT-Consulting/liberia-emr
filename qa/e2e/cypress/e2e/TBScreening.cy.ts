import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';
import TbScreeningFormPage from '../pages/tbScreeningForm';

const saveTest = Cypress.env('SKIP_TB_SCREENING_SAVE_TEST') === true ? it.skip : it;

describe('TB Screening form', () => {
    const visitPage = new VisitPage();
    const tbScreeningForm = new TbScreeningFormPage();

    beforeEach(() => {
        loginWithSession();
        visitPage.registerPatient();
        visitPage.startVisit();
        tbScreeningForm.openClinicalForms();
        tbScreeningForm.selectForm('TB Screening');
    });

    it('validates required radio groups and the score contract', () => {
        tbScreeningForm.verifyFormContract();
    });

    it('completes a negative screening with no treatment date and a zero score', () => {
        tbScreeningForm.completeNegativeScreening();
    });

    it('calculates the score for mixed symptom answers', () => {
        tbScreeningForm.completeMixedScreening();
    });

    it('shows the required treatment date only for previous TB treatment', () => {
        tbScreeningForm.verifyPreviousTreatmentDateToggle();
    });

    saveTest('rejects incomplete required fields and saves the completed form', () => {
        tbScreeningForm.verifyRequiredFieldsAndSave();
    });
});
