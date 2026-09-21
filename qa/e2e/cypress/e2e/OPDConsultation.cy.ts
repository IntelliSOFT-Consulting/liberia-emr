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
});