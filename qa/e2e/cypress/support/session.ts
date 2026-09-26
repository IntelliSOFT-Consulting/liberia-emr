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
            });
        }
    );
};
