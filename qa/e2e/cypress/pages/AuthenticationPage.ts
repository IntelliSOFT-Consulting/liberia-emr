class AuthenticationPage {
    visitPage() {
        cy.visit('/openmrs/spa/login');
    }

    verifyLoginPageLoaded() {
        cy.contains('Username', { timeout: 10000 }).should('be.visible');
    }

    login(username: string, password: string) {
        cy.get('[name="username"]').type(username);
        cy.contains('Continue').click();
        cy.get('[name="password"]').type(password);
        cy.get('button[type="submit"]').click();

       // cy.get('input[name="loginLocations"]').should('have.length.greaterThan', 0);
       // cy.get('input[name="loginLocations"]', {timeout: 20000}).first().check({ force: true }).should('be.checked');

       // cy.contains('button', 'Confirm', { timeout: 20000 }).should('be.enabled').click();
       // cy.url({ timeout: 300000 }).should('include', '/openmrs/spa/home');
        cy.contains(/Service queues/i, { timeout: 100000 }).should('be.visible');
    }
}
export default AuthenticationPage;