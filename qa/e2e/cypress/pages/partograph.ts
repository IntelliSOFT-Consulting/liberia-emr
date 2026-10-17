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

    openAdmissionForm() {
        cy.contains('button', /^Record Labour Admission$/, { timeout: this.chartLoadTimeout }).click();
    }

    seedAdmissionDilation(encounterUuid: string, patientUuid: string, value: number) {
        // MCH variables.properties: var.concept.partograph.cervical-dilation.uuid.
        const concept = '34cffe7c-726f-5da4-ade1-c67e3209f5eb';
        return cy.request<{ uuid: string }>({
            method: 'POST',
            url: '/openmrs/ws/rest/v1/obs',
            body: {
                person: patientUuid,
                encounter: encounterUuid,
                concept,
                obsDatetime: new Date().toISOString(),
                value,
            },
        }).then(({ status, body }) => {
            expect(status, 'seed dilation response').to.be.oneOf([200, 201]);
            expect(body.uuid, 'seeded observation UUID').to.be.a('string').and.not.be.empty;
            return cy.request<{ value: number }>(`/openmrs/ws/rest/v1/obs/${body.uuid}?v=full`)
                .its('body.value').should('eq', value);
        });
    }

    verifyMonitoringBlocked() {
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"]').within(() => {
            cy.get('table, canvas, [role="tablist"]').should('not.exist');
        });
    }

    verifyActiveMonitoring(dilation: number) {
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"]', {
            timeout: this.chartLoadTimeout,
        }).within(() => {
            cy.contains('th', 'Cervical dilatation (cm)', { timeout: this.chartLoadTimeout }).should('be.visible');
            cy.get('tbody tr').should('have.length', 1);
            cy.get('tbody tr').first().find('td').eq(4).should('have.text', String(dilation));
            cy.contains('button', /^Add$/).should('be.visible');
            cy.contains('There are no Partograph to display').should('not.exist');
            cy.contains('The Partograph is only available after').should('not.exist');
        });
    }
}

export default PartographPage;
