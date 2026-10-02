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
});