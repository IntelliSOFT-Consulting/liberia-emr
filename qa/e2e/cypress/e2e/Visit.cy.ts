import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';

describe('Visit', () => {
    const visitPage = new VisitPage();

    beforeEach(() => {
        loginWithSession();
    });

    it('should start a visit after registering a patient', () => {
        visitPage.registerPatient();
        visitPage.startVisit();
        visitPage.verifyVisitActive();
    })
})
