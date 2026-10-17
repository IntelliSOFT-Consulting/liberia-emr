class PartographPage {
    private readonly chartLoadTimeout = 60000;

    private waitForChart() {
        cy.contains('a', /^Patient summary$/i, { timeout: this.chartLoadTimeout }).should('be.visible');
    }

    openDashboard() {
        this.waitForChart();
        cy.contains('a', /^Partograph$/, { timeout: this.chartLoadTimeout })
            .should('be.visible')
            .click();
        cy.contains('h4', /^Partograph$/, { timeout: this.chartLoadTimeout }).should('be.visible');
    }

    verifyDashboardLinkHidden() {
        this.waitForChart();
        cy.contains('a', /^Partograph$/).should('not.exist');
    }

    openDashboardDirectly() {
        cy.location('pathname').then((pathname) => {
            const chartPath = pathname.match(/^\/openmrs\/spa\/patient\/[0-9a-f-]+\/chart\b/i)?.[0];
            expect(chartPath, 'current patient chart path').to.be.a('string').and.not.be.empty;
            cy.visit(`${chartPath}/partograph`);
        });
        cy.location('pathname').should('match', /\/chart\/partograph\/?$/);
    }

    verifyFemaleOnlyAccess() {
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"]', {
            timeout: this.chartLoadTimeout,
        }).within(() => {
            cy.contains('The Partograph is only available for female patients.', {
                timeout: this.chartLoadTimeout,
            }).should('be.visible');
            cy.get('table, canvas, [role="tablist"], button').should('not.exist');
            cy.contains('The Partograph is only available after').should('not.exist');
        });
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
