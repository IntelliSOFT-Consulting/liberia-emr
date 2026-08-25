import AuthenticationPage from '../pages/AuthenticationPage';

export const loginWithSession = () => {
    const username = Cypress.env('USERNAME') as string | undefined;
    const password = Cypress.env('PASSWORD') as string | undefined;

    expect(username, 'USERNAME in cypress.env.json').to.be.a('string').and.not.be.empty;
    expect(password, 'PASSWORD in cypress.env.json').to.be.a('string').and.not.be.empty;

    cy.session([username], () => {
        const authPage = new AuthenticationPage();
        authPage.visitPage();
        authPage.verifyLoginPageLoaded();
        authPage.login(username as string, password as string);
    });
};
