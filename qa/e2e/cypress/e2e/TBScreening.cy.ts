import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';
import TbScreeningFormPage from '../pages/tbScreeningForm';

describe('TB Screening form', () => {
    const visitPage = new VisitPage();
    const tbScreeningForm = new TbScreeningFormPage();

    beforeEach(() => {
        loginWithSession();
    });

    it('should complete a TB Screening form for a patient with an active visit', () => {
        visitPage.registerPatient();
        visitPage.startVisit();

        tbScreeningForm.openClinicalForms();
        tbScreeningForm.selectForm('TB Screening');
        tbScreeningForm.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMoreScore: 2,
            nightSweatsScore: 1,
            weightLossScore: 1,
            feverScore: 1,
            swellingScore: 1,
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Negative',
            observation: 'Automated test entry'
        });
        tbScreeningForm.submitForm();
    })
})

