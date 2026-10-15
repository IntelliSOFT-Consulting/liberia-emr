class PartographPage {
    private readonly chartLoadTimeout = 60000;

    openDashboard() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', {
            timeout: this.chartLoadTimeout,
        }).should('be.visible');
        cy.contains('a', /^Partograph$/, { timeout: this.chartLoadTimeout }).click();
        cy.contains('h4', /^Partograph$/, { timeout: this.chartLoadTimeout }).should('be.visible');
    }

    verifyAdmissionRequired() {
        cy.contains(
            'The Partograph is only available after a "1. First and Second Stage of Labor and Delivery" encounter has been completed.',
            { timeout: this.chartLoadTimeout },
        ).should('be.visible');
        cy.contains('button', /^Record Labour Admission$/, { timeout: this.chartLoadTimeout }).should('be.visible');
    }
}

export default PartographPage;
