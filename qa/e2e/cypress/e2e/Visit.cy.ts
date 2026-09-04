import { loginWithSession } from '../support/session';
import VisitPage from '../pages/visit';

describe('Visit', () => {
    const visitPage = new VisitPage();
    const runLiveVisit = Cypress.env('RUN_LIVE_REGISTRATION') === true ? it : it.skip;

    beforeEach(() => {
        loginWithSession();
    });

    runLiveVisit('should start a visit after registering a patient', () => {
        visitPage.registerPatient();
        visitPage.startVisit();
        visitPage.verifyVisitActive();
    })

    runLiveVisit('should hide the Active Visit tag after ending the visit', () => {
        visitPage.registerPatient();
        visitPage.startVisit();
        visitPage.verifyVisitActive();
        visitPage.endVisit();
        visitPage.verifyVisitNotActive();
    })
})
