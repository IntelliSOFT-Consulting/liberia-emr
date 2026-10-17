import { loginWithSession } from '../support/session';
import { randomAdultBirthdateParts } from '../support/faker';
import VisitPage from '../pages/visit';
import PartographPage from '../pages/partograph';

const visitPage = new VisitPage();
const partographPage = new PartographPage();

const registerPatientWithVisit = (sex: 'male' | 'female') => {
    visitPage.registerPatient({
        sex,
        birthdate: randomAdultBirthdateParts(18, 40),
    });
    visitPage.startVisit();
};

describe('Partograph access and prerequisites', { retries: 1 }, () => {
    beforeEach(() => {
        loginWithSession();
    });

    it('shows the Partograph link for a female patient and requires Labour Admission before monitoring', () => {
        registerPatientWithVisit('female');
        partographPage.openDashboard();
        partographPage.verifyAdmissionRequired();
    });

    it('hides the Partograph link for a male patient and blocks monitoring on direct navigation', () => {
        registerPatientWithVisit('male');
        partographPage.verifyDashboardLinkHidden();
        partographPage.openDashboardDirectly();
        partographPage.verifyFemaleOnlyAccess();
        partographPage.verifyDashboardLinkHidden();
    });
});
