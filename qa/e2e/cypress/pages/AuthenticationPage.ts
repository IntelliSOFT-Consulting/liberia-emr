class AuthenticationPage {
    visitPage() {
        cy.visit('/openmrs/spa/login');
    }

    verifyLoginPageLoaded() {
        cy.get('#username', { timeout: 15000 }).should('be.visible');
        cy.get('#password', { timeout: 15000 }).should('be.visible');
    }

    login(username: string, password: string) {
        cy.get('#username', { timeout: 15000 })
            .clear()
            .type(username);
        cy.get('#password', { timeout: 15000 })
            .clear()
            .type(password);

        cy.contains('button', 'Log in', { timeout: 15000 })
            .should('be.enabled')
            .click();

        cy.get('input[name="loginLocations"]', { timeout: 20000 })
            .should('have.length.greaterThan', 0)
            .first()
            .check({ force: true })
            .should('be.checked');
        cy.contains('button', 'Confirm', { timeout: 20000 })
            .should('be.enabled')
            .click();

        cy.url({ timeout: 30000 }).should('include', '/openmrs/spa');
        cy.get('header', { timeout: 30000 }).should('be.visible');
    }
}
export default AuthenticationPage;