import AuthenticationPage from '../pages/AuthenticationPage';

export const loginWithSession = () => {
    cy.env<{ USERNAME?: string; PASSWORD?: string }>(['USERNAME', 'PASSWORD']).then(
        ({ USERNAME: username, PASSWORD: password }) => {
            const baseUrl = Cypress.config('baseUrl') as string | undefined;

            if (!username || !password) {
                throw new Error('Missing Cypress credentials: set CYPRESS_USERNAME/CYPRESS_PASSWORD or qa/e2e/cypress.env.json');
            }

            cy.session([username, baseUrl ?? ''], () => {
                const authPage = new AuthenticationPage();
                authPage.visitPage();
                authPage.verifyLoginPageLoaded();
                authPage.login(username, password);
            }, {
                validate() {
                    // Restored activity older than the MOH idle limit triggers logout when the chart loads.
                    cy.getAllLocalStorage().then((storage) => {
                        const origin = new URL(baseUrl ?? '').origin;
                        const activityAt = Number(storage[origin]?.['liberiaemr.lastHumanActivityAt']);
                        expect(activityAt, 'cached session human activity timestamp')
                            .to.be.greaterThan(Date.now() - 10 * 60 * 1000);
                        expect(activityAt, 'cached session human activity timestamp').to.be.at.most(Date.now() + 5000);
                    });
                    cy.request<{ authenticated: boolean }>('/openmrs/ws/rest/v1/session')
                        .its('body.authenticated').should('eq', true);
                }
            });
        }
    );
};
