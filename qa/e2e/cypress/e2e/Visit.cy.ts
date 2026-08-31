import { loginWithSession } from '../support/session';
import Visit from '../pages/visit';

describe('Visit', () => {
    const visitPage = new Visit();

    beforeEach(() => {
        loginWithSession();
    });

    it('should start a visit after registering a patient', () => {
        visitPage.registerPatient();
        visitPage.startVisit();
        visitPage.verifyVisitActive();
    })
})
