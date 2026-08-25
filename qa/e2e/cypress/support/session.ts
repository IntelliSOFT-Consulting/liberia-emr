import AuthenticationPage from '../pages/AuthenticationPage';

export const loginWithSession = () => {
    const username = Cypress.env('USERNAME') as string | undefined;
    const password = Cypress.env('PASSWORD') as string | undefined;

    if (!username || !password) {
        throw new Error('Missing Cypress credentials: set CYPRESS_USERNAME/CYPRESS_PASSWORD or qa/e2e/cypress.env.json');
    }

    cy.session([username], () => {
        const authPage = new AuthenticationPage();
        authPage.visitPage();
        authPage.verifyLoginPageLoaded();
        authPage.login(username, password);
    });
};
