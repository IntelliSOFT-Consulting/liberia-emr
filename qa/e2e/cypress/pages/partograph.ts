export type PartographAssessment = {
    fetal_heart_rate: string;
    cervical_dilatation: string;
    contractions_per_10_minutes: string;
    drugs_given_and_iv_fluids: string;
};

type SavedEncounter = {
    uuid: string;
    encounterDatetime: string;
    obs: Array<{ concept: { uuid: string }; value: string | number }>;
};

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

    openAssessmentForm() {
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"]').within(() => {
            cy.contains('button', /^Add$/, { timeout: this.chartLoadTimeout }).click();
        });
        cy.get('#cervical_dilatation', { timeout: this.chartLoadTimeout }).should('be.visible');
    }

    saveAssessment(assessment: PartographAssessment) {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('savePartograph');
        cy.contains('button', /^Save$/).click();
        return cy.wait('@savePartograph', { timeout: this.chartLoadTimeout }).then(({ request, response }) => {
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            const submitted = request.body.obs as Array<{
                formFieldPath: string;
                concept: string | { uuid: string };
                value: string | number;
            }>;
            const uuid = response?.body.uuid;
            expect(uuid, 'saved Partograph encounter UUID').to.be.a('string').and.not.be.empty;
            return cy.request<SavedEncounter>(`/openmrs/ws/rest/v1/encounter/${uuid}?v=full`).then(({ body }) => {
                Object.entries(assessment).forEach(([fieldId, value]) => {
                    const observation = submitted.find((obs) => obs.formFieldPath === `rfe-forms-${fieldId}`);
                    expect(observation, `submitted ${fieldId}`).to.exist;
                    if (!observation) {
                        throw new Error(`Missing submitted Partograph observation: ${fieldId}`);
                    }
                    expect(String(observation.value), `submitted ${fieldId} value`).to.equal(value);
                    const concept = typeof observation.concept === 'string'
                        ? observation.concept : observation.concept.uuid;
                    const persisted = body.obs.find((obs) => obs.concept.uuid === concept);
                    expect(persisted, `persisted ${fieldId}`).to.exist;
                    if (!persisted) {
                        throw new Error(`Missing persisted Partograph observation: ${fieldId}`);
                    }
                    expect(String(persisted.value), `persisted ${fieldId} value`).to.equal(value);
                });
                expect(new Date(body.encounterDatetime).getTime(), 'saved assessment date').not.to.be.NaN;
                return body.encounterDatetime;
            });
        });
    }

    verifyAssessment(assessment: PartographAssessment, encounterDatetime: string) {
        const date = new Date(encounterDatetime);
        const month = date.toLocaleString('en', { month: 'short' });
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr', {
            timeout: this.chartLoadTimeout,
        }).should('have.length', 2);
        cy.contains('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr',
            assessment.drugs_given_and_iv_fluids, { timeout: this.chartLoadTimeout }).within(() => {
            cy.get('td').eq(0).invoke('text').should((text) => {
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                if (date.toDateString() === today.toDateString()) {
                    expect(text, 'assessment date').to.match(/^Today,/);
                } else if (date.toDateString() === yesterday.toDateString()) {
                    expect(text, 'assessment date').to.match(/^Yesterday,/);
                } else {
                    expect(text, 'assessment day').to.match(new RegExp(`\\b0?${date.getDate()}\\b`));
                    expect(text, 'assessment month').to.contain(month);
                    expect(text, 'assessment year').to.contain(String(date.getFullYear()));
                }
                const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                expect(text.replace(/\s+/g, ' ').trim(), 'assessment time')
                    .to.contain(time.replace(/\s+/g, ' '));
            });
            cy.get('td').eq(1).should('have.text', assessment.fetal_heart_rate);
            cy.get('td').eq(4).should('have.text', assessment.cervical_dilatation);
            cy.get('td').eq(5).should('have.text', assessment.contractions_per_10_minutes);
            cy.get('td').eq(7).should('have.text', assessment.drugs_given_and_iv_fluids);
        });
    }
}

export default PartographPage;
