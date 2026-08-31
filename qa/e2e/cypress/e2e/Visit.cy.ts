import { loginWithSession } from '../support/session';
import Visit from '../pages/visit';

describe('Visit', () => {
    const visitPage = new Visit();

    beforeEach(() => {
        loginWithSession();
    });

    it('should register a patient before starting a visit', () => {
        visitPage.registerPatient();
        visitPage.startVisit();
    })
})
