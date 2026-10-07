import { DateParts, toDateParts } from '../support/faker';

type Guidance = keyof typeof FamilyPlanningFormPage.guidanceText;

class FamilyPlanningFormPage {
    static readonly guidanceText = {
        provideMethod: 'Provide the method now.',
        provideImplant: 'Provide the implant now.',
        deferIud: 'Do not insert the IUD at this visit.',
    };

    private readonly implantMessages = {
        breastCancer: 'Breast cancer reported',
        caution: 'WHO MEC Category 3 condition present',
        negative: 'No Category 3 or 4 condition found',
    };

    private readonly lamMessages = {
        met: 'LAM criteria met.',
        notEligible: 'LAM cannot be relied on.',
        uncertain: 'Breastfeeding criterion not confirmed.',
    };

    constructor(
        private readonly timeout = 20000,
        private readonly chartLoadTimeout = 60000,
    ) {}

    private checkOption(id: string) {
        cy.get(`input[id="${id}"]`, { timeout: this.timeout }).should('not.be.disabled');
        cy.get(`label[for="${id}"]`, { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible')
            .click();
        cy.get(`input[id="${id}"]`).should('be.checked');
    }

    openClinicalForms() {
        cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: this.chartLoadTimeout })
            .should('be.visible');
        cy.get('button[aria-label="Clinical forms"]', { timeout: this.chartLoadTimeout })
            .should('be.visible')
            .click();
    }

    selectForm() {
        cy.contains('a.cds--link', '3. Family Planning', { timeout: this.chartLoadTimeout }).click();
    }

    reopenForm() {
        cy.reload();
        this.openClinicalForms();
        this.selectForm();
    }

    selectClientType(clientType: 'New Family Planning Client' | 'Continuing Family Planning Client') {
        this.checkOption(`familyPlanningClientType-${clientType}`);
    }

    selectCounsellingDone(answer: 'Yes' | 'No') {
        this.checkOption(`counsellingDone-${answer}`);
    }

    selectPurposeForCommodities() {
        cy.contains('label', /^For Commodities$/, { timeout: this.timeout })
            .invoke('attr', 'for')
            .then((id) => {
                expect(id, 'For Commodities checkbox identifier').to.be.a('string').and.not.be.empty;
                if (!id) {
                    throw new Error('For Commodities label is missing its checkbox identifier');
                }
                this.checkOption(id);
            });
    }

    verifyRequiredFieldBlocksSave(fieldId: 'familyPlanningClientType' | 'counsellingDone' | 'purposeOfVisit') {
        cy.get(`input[id^="${fieldId}-"]`, { timeout: this.timeout }).should('not.be.checked');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        cy.get(`[data-testid="${fieldId}-label"]`, { timeout: this.timeout })
            .parents()
            .filter(':contains("Field is mandatory")')
            .first()
            .should(($question) => {
                expect($question.find('[data-testid$="-label"]'), 'questions in error container').to.have.length(1);
            })
            .contains('Field is mandatory')
            .scrollIntoView()
            .should('be.visible');
        cy.get('@saveFamilyPlanning.all').should('have.length', 0);
    }

    verifyEmptyPurposeOfVisitBlocksSave() {
        cy.get('input[id^="purposeOfVisit-"]', { timeout: this.timeout }).should('not.be.checked');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        // Nothing appears on screen to wait for, so give a save request time to be sent.
        cy.wait(3000);
        cy.get('@saveFamilyPlanning.all').should('have.length', 0);
        cy.get('label[for^="purposeOfVisit-"]').should('be.visible');
        cy.contains('button', /^Save$/).should('be.visible');
    }

    verifyCounsellingNoHidesDownstreamFields() {
        cy.get('input[id="counsellingDone-No"]', { timeout: this.timeout }).should('be.checked');
        this.downstreamQuestionIds.forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"]`).should('not.exist');
        });
        this.downstreamSections.forEach((section) => {
            cy.contains(section).should('not.exist');
        });
    }

    verifyCounsellingYesShowsCoreFields() {
        cy.get('input[id="counsellingDone-Yes"]', { timeout: this.timeout }).should('be.checked');
        this.downstreamQuestionIds.forEach((fieldId) => {
            cy.get(`[data-testid="${fieldId}-label"]`, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        });
        ['Obstetric Profile', 'Method Record'].forEach((section) => {
            cy.contains(section, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        });
        this.methodSpecificSections.forEach((section) => {
            cy.contains(section).should('not.exist');
        });
    }

    private selectDropdownOption(fieldId: string, option: string) {
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .within(() => {
                cy.get('button[role="combobox"]').click();
            });
        cy.contains('[role="option"], .cds--list-box__menu-item', new RegExp(`^${this.escapeRegExp(option)}$`), {
            timeout: this.timeout,
        }).click();
        cy.get(`#${fieldId}`).should('contain.text', option);
    }

    private escapeRegExp(value: string) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private verifySectionVisibility(section: string, expectedVisible: boolean) {
        if (expectedVisible) {
            cy.contains(section, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        } else {
            cy.contains(section).should('not.exist');
        }
    }

    verifyChosenMethodSectionGates() {
        this.chosenMethods.forEach(({ label, pregnancy, lam, implant }) => {
            cy.log(`Chosen method: ${label}`);
            this.selectDropdownOption('chosenFamilyPlanningMethod', label);
            this.verifySectionVisibility('Pregnancy Assessment', pregnancy);
            this.verifySectionVisibility('LAM Assessment', lam);
            this.verifySectionVisibility('Implant Eligibility Assessment', implant);
            this.verifySectionVisibility('Implant Procedure', implant);
        });
    }

    verifyDispensedImplantOpensImplantSections() {
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Male condom');
        this.verifySectionVisibility('Implant Eligibility Assessment', false);

        this.selectDropdownOption('familyPlanningMethodDispensed', 'Contraceptive Implants');
        this.verifySectionVisibility('Implant Eligibility Assessment', true);
        this.verifySectionVisibility('Implant Procedure', true);
        this.verifySectionVisibility('Pregnancy Assessment', false);
        this.verifySectionVisibility('LAM Assessment', false);
    }

    verifyImplantGatesWithoutChosenMethod() {
        cy.get('#chosenFamilyPlanningMethod', { timeout: this.timeout }).should('not.contain.text', 'Contraceptive Implants');
        this.selectDropdownOption('familyPlanningMethodDispensed', 'Contraceptive Implants');
        this.verifySectionVisibility('Implant Eligibility Assessment', true);
        this.verifySectionVisibility('Implant Procedure', true);
        this.verifySectionVisibility('Pregnancy Assessment', false);
        this.verifySectionVisibility('LAM Assessment', false);

        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Contraceptive Implants');
        this.verifySectionVisibility('Implant Eligibility Assessment', true);
        this.verifySectionVisibility('Implant Procedure', true);
        this.verifySectionVisibility('Pregnancy Assessment', true);
        this.verifySectionVisibility('LAM Assessment', false);
    }

    verifyLamIsNotADispensedOption() {
        cy.get('#familyPlanningMethodDispensed', { timeout: this.timeout })
            .scrollIntoView()
            .within(() => {
                cy.get('button[role="combobox"]').click();
                cy.get('[role="option"]', { timeout: this.timeout }).should(($options) => {
                    const labels = [...$options].map((option) => option.textContent?.trim());
                    expect(labels, 'dispensed method options').to.include('Contraceptive Implants');
                    expect(labels.some((label) => /LAM|Lactational/i.test(label ?? '')), 'LAM dispensed option').to.equal(false);
                });
                cy.get('button[role="combobox"]').click();
            });
    }

    saveAndVerifyCounsellingNo(clientType: 'New Family Planning Client' | 'Continuing Family Planning Client') {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();

        cy.wait('@saveFamilyPlanning', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            const observations = request.body.obs as Array<{ formFieldPath?: string; value?: unknown }>;
            const valueFor = (fieldId: string) => {
                const value = observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`)?.value;
                return typeof value === 'object' && value !== null ? (value as { uuid?: string }).uuid : value;
            };

            expect(
                observations.map((observation) => observation.formFieldPath).sort(),
                'submitted Family Planning observations'
            ).to.deep.equal(['rfe-forms-counsellingDone', 'rfe-forms-familyPlanningClientType']);
            expect(valueFor('familyPlanningClientType'), 'saved client type').to.equal(this.clientTypeAnswers[clientType]);
            expect(valueFor('counsellingDone'), 'saved counselling done').to.equal(this.noAnswer);
        });
        cy.contains('button', /^Save$/, { timeout: this.timeout }).should('not.exist');
    }

    startCounselledVisit() {
        this.selectClientType('New Family Planning Client');
        this.selectCounsellingDone('Yes');
        this.selectPurposeForCommodities();
    }

    completeAndSubmitImplantVisit() {
        const today = new Date();
        const removalPurpose = 'Jadelle or IUCD Removal';

        this.selectClientType('New Family Planning Client');
        this.selectCounsellingDone('Yes');
        this.selectPurposeForCommodities();
        cy.contains('label', new RegExp(`^${this.escapeRegExp(removalPurpose)}$`), { timeout: this.timeout })
            .invoke('attr', 'for')
            .then((id) => this.checkOption(String(id)));
        this.verifySectionVisibility('Method Removal', true);
        this.enterDate('dateMethodRemoved', today);

        this.setNumber('parity', '2');
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Contraceptive Implants');
        this.selectDropdownOption('familyPlanningMethodDispensed', 'Contraceptive Implants');
        this.verifySectionVisibility('LAM Assessment', false);

        this.answer('amenorrhea', 'Yes');
        this.answer('missedOrLateMenses', 'No');
        this.setNumber('daysSinceUnprotectedSex', '3');
        this.answer('pregnancyTestResult', 'Negative');
        cy.contains(FamilyPlanningFormPage.guidanceText.provideImplant, { timeout: this.timeout }).scrollIntoView().should('be.visible');
        cy.contains('Offer emergency contraception.', { timeout: this.timeout }).scrollIntoView().should('be.visible');
        this.verifyRepeatPregnancyTestDateShown(this.daysFromToday(21));

        ['unexplainedVaginalBleeding', 'historyOfBreastCancer', 'severeLiverDisease', 'currentDvtOrPulmonaryEmbolism'].forEach(
            (fieldId) => this.answer(fieldId, 'No')
        );
        this.verifyMessages(this.implantMessages, ['negative']);

        this.answer('implantInserted', 'Yes');
        this.enterDate('implantInsertionDate', today);

        this.saveAndGetObservations().then((observations) => {
            const value = (fieldId: string) => this.observationValue(observations, fieldId);
            const purposes = observations
                .filter((observation) => observation.formFieldPath === 'rfe-forms-purposeOfVisit')
                .map((observation) => {
                    const answer = observation.value;
                    return typeof answer === 'object' && answer !== null ? (answer as { uuid?: string }).uuid : answer;
                });

            expect(value('familyPlanningClientType'), 'client type').to.equal(this.clientTypeAnswers['New Family Planning Client']);
            expect(value('counsellingDone'), 'counselling done').to.equal(this.yesAnswer);
            expect(purposes, 'purposes of visit').to.have.members([
                this.submitAnswers.forCommodities,
                this.submitAnswers.jadelleIucdRemoval,
            ]);
            expect(Number(value('parity')), 'parity').to.equal(2);
            expect(value('chosenFamilyPlanningMethod'), 'chosen method').to.equal(this.submitAnswers.implants);
            expect(value('familyPlanningMethodDispensed'), 'dispensed method').to.equal(this.submitAnswers.implants);
            expect(value('amenorrhea'), 'amenorrhea').to.equal(this.yesAnswer);
            expect(value('missedOrLateMenses'), 'missed or late menses').to.equal(this.noAnswer);
            expect(Number(value('daysSinceUnprotectedSex')), 'days since unprotected sex').to.equal(3);
            expect(value('pregnancyTestResult'), 'pregnancy test result').to.equal(this.submitAnswers.negative);
            expect(String(value('repeatPregnancyTestDate')), 'repeat pregnancy test date').to.contain(
                this.isoDate(this.daysFromToday(21))
            );
            ['unexplainedVaginalBleeding', 'historyOfBreastCancer', 'severeLiverDisease', 'currentDvtOrPulmonaryEmbolism'].forEach(
                (fieldId) => expect(value(fieldId), fieldId).to.equal(this.noAnswer)
            );
            expect(value('implantInserted'), 'implant inserted').to.equal(this.yesAnswer);
            expect(String(value('implantInsertionDate')), 'implant insertion date').to.contain(this.isoDate(today));
            expect(String(value('dateMethodRemoved')), 'date method removed').to.contain(this.isoDate(today));
            ['exclusiveBreastfeeding', 'dateOfLastDelivery'].forEach((fieldId) =>
                expect(value(fieldId), `${fieldId} (hidden LAM field)`).to.equal(undefined)
            );
        });
        cy.contains('button', /^Save$/, { timeout: this.timeout }).should('not.exist');
    }

    private answer(fieldId: string, answer: string) {
        this.checkOption(`${fieldId}-${answer}`);
    }

    private setNumber(fieldId: string, value: string) {
        // An emptied number input reverts to 0, so overwrite the selected text instead of clearing it.
        cy.get(`#${fieldId}`, { timeout: this.timeout })
            .scrollIntoView()
            .type(`{selectall}${value}`)
            .should('have.value', value)
            .blur();
    }

    private enterDate(fieldId: string, date: Date) {
        cy.get(`#${fieldId}`, { timeout: this.timeout }).scrollIntoView().within(() => {
            Object.entries(toDateParts(date)).forEach(([part, value]) => {
                cy.get(`[data-type="${part}"]`, { timeout: this.timeout }).click().type(value);
            });
        });
    }

    // Read-only fields render their value as text, e.g. "29-Oct-2026", not as a date input.
    private repeatPregnancyTestDate() {
        return cy
            .contains('.cds--label', 'Repeat pregnancy test due', { timeout: this.timeout })
            .closest('[class*="field-value-view__readonly"]');
    }

    private verifyRepeatPregnancyTestDateShown(expected: Date) {
        const { day, year } = toDateParts(expected);
        const month = expected.toLocaleString('en-US', { month: 'short' });
        this.repeatPregnancyTestDate()
            .scrollIntoView()
            .should('be.visible')
            .within(() => {
                cy.get('[class*="value__value"]').should('have.text', `${day}-${month}-${year}`);
                cy.get('input, [contenteditable="true"]').should('not.exist');
            });
    }

    // The hide rule should remove the field, but the engine leaves it on screen as "(Blank)" (app defect);
    // either way the calculated date must be gone.
    private verifyRepeatPregnancyTestDateCleared() {
        cy.get('body').should(($body) => {
            const field = $body.find('.cds--label:contains("Repeat pregnancy test due")').closest('[class*="field-value-view__readonly"]');
            if (field.length) {
                expect(field.text(), 'repeat pregnancy test date').not.to.match(/\d{2}-[A-Za-z]{3}-\d{4}/);
            }
        });
    }

    private daysFromToday(days: number) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date;
    }

    // Matches dayjs subtract(months): the day is clamped to the target month's last day.
    private monthsAgo(months: number) {
        const today = new Date();
        const target = new Date(today.getFullYear(), today.getMonth() - months, 1);
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        target.setDate(Math.min(today.getDate(), lastDay));
        return target;
    }

    private isoDate(date: Date) {
        const { year, month, day } = toDateParts(date);
        return `${year}-${month}-${day}`;
    }

    private verifyMessages(messages: Record<string, string>, shown: string[]) {
        Object.entries(messages).forEach(([key, text]) => {
            if (shown.includes(key)) {
                cy.contains(text, { timeout: this.timeout }).scrollIntoView().should('be.visible');
            } else {
                cy.contains(text).should('not.exist');
            }
        });
    }

    private verifySaveBlocked() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('blockedSave');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        // A blocked save shows nothing to wait on, so give any request time to be sent.
        cy.wait(3000);
        cy.get('@blockedSave.all').should('have.length', 0);
        cy.contains('button', /^Save$/).should('be.visible');
    }

    private saveAndGetObservations() {
        cy.intercept('POST', '**/ws/rest/v1/encounter**').as('saveFamilyPlanning');
        cy.contains('button', /^Save$/, { timeout: this.timeout }).click();
        return cy.wait('@saveFamilyPlanning', { timeout: this.timeout }).then(({ request, response }) => {
            expect(response?.statusCode, JSON.stringify(response?.body)).to.be.oneOf([200, 201]);
            return request.body.obs as Array<{ formFieldPath?: string; value?: unknown }>;
        });
    }

    private observationValue(observations: Array<{ formFieldPath?: string; value?: unknown }>, fieldId: string) {
        const value = observations.find((observation) => observation.formFieldPath === `rfe-forms-${fieldId}`)?.value;
        return typeof value === 'object' && value !== null ? (value as { uuid?: string }).uuid : value;
    }

    verifyImplantInsertionDateRules() {
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Contraceptive Implants');
        this.answer('implantInserted', 'Yes');

        this.verifySaveBlocked();
        cy.contains('Implant insertion date is required when an implant has been inserted', { timeout: this.timeout })
            .scrollIntoView()
            .should('be.visible');

        this.enterDate('implantInsertionDate', this.daysFromToday(1));
        this.verifySaveBlocked();

        const today = new Date();
        this.enterDate('implantInsertionDate', today);
        this.saveAndGetObservations().then((observations) => {
            expect(this.observationValue(observations, 'implantInserted'), 'saved implant inserted').to.equal(this.yesAnswer);
            expect(String(this.observationValue(observations, 'implantInsertionDate')), 'saved insertion date').to.contain(
                this.isoDate(today)
            );
        });
        cy.contains('button', /^Save$/, { timeout: this.timeout }).should('not.exist');
    }

    verifyImplantScreeningCombinations() {
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Contraceptive Implants');
        this.verifyMessages(this.implantMessages, []);

        this.answer('unexplainedVaginalBleeding', 'No');
        this.answer('historyOfBreastCancer', 'No');
        this.answer('severeLiverDisease', 'No');
        this.verifyMessages(this.implantMessages, []);

        this.answer('currentDvtOrPulmonaryEmbolism', 'No');
        this.verifyMessages(this.implantMessages, ['negative']);

        this.answer('severeLiverDisease', 'Yes');
        this.verifyMessages(this.implantMessages, ['caution']);

        this.answer('historyOfBreastCancer', 'Yes');
        this.verifyMessages(this.implantMessages, ['breastCancer']);

        this.answer('severeLiverDisease', 'No');
        this.verifyMessages(this.implantMessages, ['breastCancer']);
    }

    private answerNegativePregnancyScreen(method: string) {
        this.selectDropdownOption('chosenFamilyPlanningMethod', method);
        this.answer('amenorrhea', 'Yes');
        this.answer('pregnancyTestResult', 'Negative');
    }

    verifyNegativePregnancyTestGuidance() {
        this.answerNegativePregnancyScreen('Oral Contraceptive Pills (Microgynon)');
        this.guidanceByMethod.forEach(({ method, guidance }) => {
            cy.log(`Chosen method: ${method}`);
            this.selectDropdownOption('chosenFamilyPlanningMethod', method);
            this.verifyMessages(FamilyPlanningFormPage.guidanceText, guidance ? [guidance] : []);
        });

        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Oral Contraceptive Pills (Microgynon)');
        this.answer('pregnancyTestResult', 'Positive');
        this.verifyMessages(FamilyPlanningFormPage.guidanceText, []);
        this.answer('pregnancyTestResult', 'Negative');
        this.answer('amenorrhea', 'No');
        this.verifyMessages(FamilyPlanningFormPage.guidanceText, []);
    }

    verifyEmergencyContraceptionThresholds() {
        const emergency = { emergency: 'Offer emergency contraception.' };
        this.answerNegativePregnancyScreen('Oral Contraceptive Pills (Microgynon)');

        // Blank is checked before any entry: clearing a typed value leaves the guidance shown (app defect).
        this.verifyMessages(emergency, []);
        [
            { days: '0', shown: true },
            { days: '5', shown: true },
            { days: '6', shown: false },
        ].forEach(({ days, shown }) => {
            cy.log(`Days since unprotected sex: ${days || 'blank'}`);
            this.setNumber('daysSinceUnprotectedSex', days);
            this.verifyMessages(emergency, shown ? ['emergency'] : []);
        });

        this.setNumber('daysSinceUnprotectedSex', '3');
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Oral Contraceptive Pills (Microlut)');
        this.verifyMessages(emergency, []);
        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Oral Contraceptive Pills (Microgynon)');

        ['-1', '2.5'].forEach((days) => {
            cy.log(`Invalid days since unprotected sex: ${days}`);
            this.setNumber('daysSinceUnprotectedSex', days);
            this.verifySaveBlocked();
        });
    }

    verifyRepeatPregnancyTestDate() {
        // Expected from today's date; a forced month/year rollover needs a controlled clock (follow-up).
        const expected = this.daysFromToday(21);
        this.answerNegativePregnancyScreen('Oral Contraceptive Pills (Microgynon)');
        this.verifyRepeatPregnancyTestDateShown(expected);

        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Intrauterine device');
        this.verifyRepeatPregnancyTestDateShown(expected);

        this.answer('pregnancyTestResult', 'Positive');
        this.verifyRepeatPregnancyTestDateCleared();
        this.answer('pregnancyTestResult', 'Negative');
        this.verifyRepeatPregnancyTestDateShown(expected);

        this.answer('pregnancyTestResult', 'Positive');
        this.verifyRepeatPregnancyTestDateCleared();
        this.saveAndGetObservations().then((observations) => {
            expect(
                observations.some((observation) => observation.formFieldPath === 'rfe-forms-repeatPregnancyTestDate'),
                'stale repeat pregnancy test date observation'
            ).to.equal(false);
        });
    }

    verifyLamEligibilityCombinations() {
        // LAM rules compare against today, not the encounter date; month-end boundaries need a controlled clock (follow-up).
        const exactlySixMonthsAgo = this.monthsAgo(6);
        const justUnderSixMonthsAgo = new Date(exactlySixMonthsAgo);
        justUnderSixMonthsAgo.setDate(justUnderSixMonthsAgo.getDate() + 1);

        this.selectDropdownOption('chosenFamilyPlanningMethod', 'Lactational Amenorrhea Method (LAM)');
        this.answer('amenorrhea', 'Yes');
        this.answer('exclusiveBreastfeeding', 'Yes');
        this.verifyMessages(this.lamMessages, []);

        this.enterDate('dateOfLastDelivery', justUnderSixMonthsAgo);
        this.verifyMessages(this.lamMessages, ['met']);

        this.enterDate('dateOfLastDelivery', exactlySixMonthsAgo);
        this.verifyMessages(this.lamMessages, ['notEligible']);

        this.enterDate('dateOfLastDelivery', justUnderSixMonthsAgo);
        this.answer('exclusiveBreastfeeding', 'No');
        this.verifyMessages(this.lamMessages, ['uncertain']);

        this.answer('exclusiveBreastfeeding', 'Yes');
        this.answer('amenorrhea', 'No');
        this.verifyMessages(this.lamMessages, ['notEligible']);
    }

    private readonly yesAnswer = '1065AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    private readonly guidanceByMethod: Array<{ method: string; guidance: Guidance | null }> = [
        { method: 'Oral Contraceptive Pills (Microgynon)', guidance: 'provideMethod' },
        { method: 'Injectable contraceptives', guidance: 'provideMethod' },
        { method: 'Sayana Press', guidance: 'provideMethod' },
        { method: 'Contraceptive Implants', guidance: 'provideImplant' },
        { method: 'Intrauterine device', guidance: 'deferIud' },
        { method: 'Oral Contraceptive Pills (Microlut)', guidance: null },
        { method: 'Lactational Amenorrhea Method (LAM)', guidance: null },
    ];

    private readonly noAnswer = '1066AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    private readonly submitAnswers = {
        forCommodities: 'a43bf815-94e8-4a04-84c1-dced08b31a4f',
        jadelleIucdRemoval: '1e9c4f70-6a8d-4e01-88a9-48b2c6f0d3fc',
        implants: 'fc2a46e5-489b-4eaf-a875-26e4d3a5607e',
        negative: '664AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };

    private readonly clientTypeAnswers = {
        'New Family Planning Client': '5f3c9e14-0a27-4e5a-b243-e2c608a4d7f6',
        'Continuing Family Planning Client': '7a5e0b36-2c49-4e7c-8465-04e82ac6f9b8',
    };

    private readonly downstreamQuestionIds = [
        'purposeOfVisit',
        'parity',
        'chosenFamilyPlanningMethod',
        'familyPlanningMethodDispensed',
    ];

    private readonly chosenMethods = [
        { label: 'Contraceptive Implants', pregnancy: true, lam: false, implant: true },
        { label: 'Cycle Beads', pregnancy: false, lam: false, implant: false },
        { label: 'Female condom', pregnancy: false, lam: false, implant: false },
        { label: 'Injectable contraceptives', pregnancy: true, lam: false, implant: false },
        { label: 'Intrauterine device', pregnancy: true, lam: false, implant: false },
        { label: 'Lactational Amenorrhea Method (LAM)', pregnancy: true, lam: true, implant: false },
        { label: 'Male condom', pregnancy: false, lam: false, implant: false },
        { label: 'Oral Contraceptive Pills (Microgynon)', pregnancy: true, lam: false, implant: false },
        { label: 'Oral Contraceptive Pills (Microlut)', pregnancy: true, lam: false, implant: false },
        { label: 'Sayana Press', pregnancy: true, lam: false, implant: false },
    ];

    private readonly methodSpecificSections = [
        'Pregnancy Assessment',
        'LAM Assessment',
        'Implant Eligibility Assessment',
        'Implant Procedure',
        'Method Removal',
    ];

    private readonly downstreamSections = [
        'Obstetric Profile',
        'Method Record',
        'Pregnancy Assessment',
        'LAM Assessment',
        'Implant Eligibility Assessment',
        'Implant Procedure',
        'Method Removal',
    ];
}

export default FamilyPlanningFormPage;
