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
});