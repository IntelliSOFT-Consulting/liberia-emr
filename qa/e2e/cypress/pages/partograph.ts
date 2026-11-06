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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The time as the dashboard renders it: the framework's formatTime, in the app's i18next locale. */
const formatDashboardTime = (date: Date, win: Cypress.AUTWindow): string => {
    const appWindow = win as Cypress.AUTWindow & { i18next?: { language?: string } };
    const language = appWindow.i18next?.language || win.document.documentElement.lang || 'en';
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    let time: string;
    try {
        time = date.toLocaleTimeString(language, options);
    } catch {
        // i18next can hold a non-BCP 47 value; the framework normalizes it, so fall back to the page tag.
        time = date.toLocaleTimeString(win.document.documentElement.lang || 'en', options);
    }
    return time.replace(/\s+/g, ' ').trim();
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
        cy.get('body').then(($body) => {
            const normalAlert = $body.find('.cds--actionable-notification')
                .filter((_, element) => element.textContent?.includes('Labour Progress Normal'));
            if (normalAlert.length) {
                cy.wrap(normalAlert).find('.cds--actionable-notification__close-button').click();
            }
        });
        cy.get('#cervical_dilatation', { timeout: this.chartLoadTimeout }).should('be.visible');
        ['#fetal_heart_rate', '#cervical_dilatation', '#contractions_per_10_minutes',
            '#drugs_given_and_iv_fluids'].forEach((selector) => {
            cy.get(selector, { timeout: this.chartLoadTimeout }).should('be.enabled');
        });
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

    fillAssessment(assessment: PartographAssessment) {
        Object.entries(assessment).forEach(([fieldId, value]) => {
            const selector = `#${fieldId}`;
            cy.get(selector, { timeout: this.chartLoadTimeout }).scrollIntoView();
            cy.get(selector, { timeout: this.chartLoadTimeout })
                .should('be.visible').and('be.enabled').focus();
            cy.get(selector, { timeout: this.chartLoadTimeout })
                .type(`{selectall}${value}`).should('have.value', value);
        });
    }

    verifyAssessment(assessment: PartographAssessment, encounterDatetime: string, rowCount = 2) {
        const date = new Date(encounterDatetime);
        const month = date.toLocaleString('en', { month: 'short' });
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr', {
            timeout: this.chartLoadTimeout,
        }).should('have.length', rowCount);
        cy.contains('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr',
            assessment.drugs_given_and_iv_fluids, { timeout: this.chartLoadTimeout }).within(() => {
            cy.window().then((win) => {
                // The dashboard's formatDatetime appends the framework's formatTime:
                // toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }), where getLocale()
                // is i18next's language. Format the expected time the same way, in the page's own locale,
                // so a 24-hour locale (19:46) or a zero-padded hour (07:46 PM) is compared like for like.
                const time = formatDashboardTime(date, win);
                cy.get('td').eq(0).invoke('text').should((text) => {
                    const cell = text.replace(/\s+/g, ' ').trim();
                    const today = new Date();
                    if (date.toDateString() === today.toDateString()) {
                        expect(cell, 'assessment date').to.match(/^Today,/);
                    } else {
                        expect(cell, 'assessment month').to.contain(month);
                        expect(cell, 'assessment year').to.contain(String(date.getFullYear()));
                        // Only the date part, before the ", <time>" suffix, so the hour cannot match the day.
                        const datePart = cell.slice(0, cell.lastIndexOf(','));
                        expect(datePart, 'assessment day').to.match(new RegExp(`\\b0?${date.getDate()}\\b`));
                    }
                    expect(cell, 'assessment time').to.match(new RegExp(`, ${escapeRegExp(time)}$`));
                });
            });
            cy.get('td').eq(1).should('have.text', assessment.fetal_heart_rate);
            cy.get('td').eq(4).should('have.text', assessment.cervical_dilatation);
            cy.get('td').eq(5).should('have.text', assessment.contractions_per_10_minutes);
            cy.get('td').eq(7).should('have.text', assessment.drugs_given_and_iv_fluids);
        });
    }

    verifyAssessmentOrder(newest: PartographAssessment, older: PartographAssessment) {
        cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr', {
            timeout: this.chartLoadTimeout,
        }).should('have.length', 3);
        [newest, older].forEach((assessment, index) => {
            cy.get('[data-extension-slot-name="patient-chart-partograph-dashboard-slot"] tbody tr')
                .eq(index).find('td').eq(7).should('have.text', assessment.drugs_given_and_iv_fluids);
        });
    }

}

export default PartographPage;
