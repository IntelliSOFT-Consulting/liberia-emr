class QueuePage {
    visitHomePage() {
        cy.visit('/openmrs/spa/home');
    }

    private clickAddPatientToQueue() {
        cy.contains('button', 'Add patient to queue', { timeout: 20000 }).click();
    }

    private searchForPatient(name: string) {
        cy.get('[data-testid="patientSearchBar"]', { timeout: 20000 }).clear().type(name);
    }

    searchAndSelectPatient(name: string) {
        this.clickAddPatientToQueue();
        this.searchForPatient(name);

        cy.contains('[role="banner"]', name, { timeout: 20000 })
            .find('button[aria-label="Start visit"]', { timeout: 20000 })
            .click({ force: true });
    }

    startVisitFromSearch(visitType = 'Outpatient', paymentDetails: 'paying' | 'non-paying' = 'paying') {
        cy.contains('.cds--radio-button-wrapper', visitType, { timeout: 20000 })
            .find('input[name="visit-types"]')
            .check({ force: true });

        cy.get(`#payment-details-${paymentDetails}`, { timeout: 20000 }).check({ force: true });

        cy.get('[data-openmrs-role="Start Visit Form"]', { timeout: 20000 })
            .find('button[type="submit"]')
            .should('be.enabled')
            .click();

        cy.wait(2000);
    }

    openQueueFormForPatient(name: string) {
        cy.contains('[role="banner"]', name, { timeout: 20000 })
            .find('button:not([aria-label])')
            .first()
            .click({ force: true });

    }

    addPatientToServiceQueue(service: string, priority: 'Routine' | 'Emergency (status)' = 'Routine', queueLocation = 'Careysburg OPD') {
        cy.get('#queueLocation', { timeout: 20000 }).should('be.visible').select(queueLocation);
        cy.get('#queueService', { timeout: 20000 }).should('be.visible').select(service);
        cy.contains('.cds--radio-button-wrapper', priority, { timeout: 20000 })
            .find('input[name="priority"]')
            .check({ force: true });

        cy.contains('button', 'Add patient to queue', { timeout: 20000 }).should('be.enabled').click();
    }

    verifyPatientInQueue(patientName: string, service: string) {
        cy.get('input[placeholder="Search this list"]', { timeout: 20000 })
            .clear()
            .type(patientName);

        cy.get('tbody', { timeout: 30000 })
            .contains('a', patientName, { timeout: 30000 })
            .closest('tr')
            .within(() => {
                cy.contains('td', service, { timeout: 20000 }).should('be.visible');
            });
    }
}

export default QueuePage;
