import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';
import TbScreeningFormPage from '../pages/tbScreeningForm';

describe('TB Screening form', () => {
    const visitPage = new VisitPage();
    const tbScreeningForm = new TbScreeningFormPage();

    const openFormForNewPatient = () => {
        visitPage.registerPatient();
        visitPage.startVisit();

        tbScreeningForm.openClinicalForms();
        tbScreeningForm.selectForm('TB Screening');
    };

    beforeEach(() => {
        loginWithSession();
    });

    it('should complete a TB Screening form for a patient with an active visit', () => {
        openFormForNewPatient();

        tbScreeningForm.fillForm({
            contactOfTbPatient: 'No',
            previouslyTreatedForTb: 'No',
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'No',
            fever: 'Yes',
            swelling: 'No',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Negative',
            observation: 'Automated test entry'
        });

        // Coughing scores 2, night sweats and fever score 1 each; the two No answers score 0.
        tbScreeningForm.expectTotalScore(4);
        tbScreeningForm.expectTreatmentStartDateHidden();

        tbScreeningForm.submitForm();
    });

    it('should capture the treatment start date when the patient was previously treated for TB', () => {
        openFormForNewPatient();

        tbScreeningForm.fillForm({
            contactOfTbPatient: 'Yes',
            previouslyTreatedForTb: 'Yes',
            dateTbTreatmentStarted: { day: '02', month: '01', year: '2025' },
            coughing2WeeksOrMore: 'Yes',
            nightSweats: 'Yes',
            weightLoss: 'Yes',
            fever: 'Yes',
            swelling: 'Yes',
            dateScreeningConducted: { day: '01', month: '01', year: '2025' },
            sputumTestResult: 'Positive',
            observation: 'Automated test entry - previously treated'
        });

        tbScreeningForm.expectTotalScore(6);

        tbScreeningForm.submitForm();
    });
});
