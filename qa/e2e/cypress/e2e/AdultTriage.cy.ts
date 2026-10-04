import { loginWithSession } from '../support/session';
import { randomAdultBirthdateParts } from '../support/faker';
import VisitPage from '../pages/visit';
import AdultTriageFormPage from '../pages/adultTriageForm';

describe('Adult Triage Assessment form', () => {
    const visitPage = new VisitPage();
    const triageForm = new AdultTriageFormPage();

    beforeEach(() => {
        loginWithSession();
        visitPage.registerPatient({ birthdate: randomAdultBirthdateParts(25, 35) });
        visitPage.startVisit();
        triageForm.openClinicalForms();
        triageForm.selectForm();
    });

    it('opens with the adult fields and hides child-only fields', () => {
        triageForm.verifyAdultFormContract();
    });

    it('blocks saving when the required pain score is omitted', () => {
        triageForm.verifyPainScoreRequired();
    });

    it('validates adult vital and pain-score limits', () => {
        triageForm.verifyAdultNumericLimits();
    });

    it('requires diastolic pressure to be lower than systolic pressure', () => {
        triageForm.verifyDiastolicMustBeBelowSystolic();
    });

    it('shows shared and blood-pressure warnings without blocking save', () => {
        triageForm.verifyAdultWarningsAllowSave();
    });

    it('saves a complete adult assessment with calculated BMI and no child-only observations', () => {
        triageForm.verifyBmiCalculationAndSave();
    });
});