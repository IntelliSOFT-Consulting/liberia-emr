import AuthenticationPage from '../pages/AuthenticationPage';

export const loginWithSession = () => {
    const config = Cypress.config() as any;
    const env = config?.env ?? {};
    const username = typeof env.USERNAME === 'string' ? env.USERNAME : 'admin';
    const password = typeof env.PASSWORD === 'string' ? env.PASSWORD : 'Admin123';

    cy.session([username], () => {
        const authPage = new AuthenticationPage();
        authPage.visitPage();
        authPage.verifyLoginPageLoaded();
        authPage.login(username, password);
    });
};
