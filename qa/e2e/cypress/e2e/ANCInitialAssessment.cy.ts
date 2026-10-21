import { loginWithSession } from '../support/session';
import { AncEnrolment, enrolInAnc } from '../support/anc-enrolment';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import ANCInitialFormPage from '../pages/ancInitialForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const ancInitialForm = new ANCInitialFormPage();

const registerMotherWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName(),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(16, 35),
        phoneNumber: liberiaPhoneNumber()
    });
    cy.intercept('POST', '**/ws/rest/v1/patient').as('registerAncPatient');
    registrationPage.clickRegisterPatient();
    const registeredPatient = cy.wait('@registerAncPatient').then(({ response }) => {
        expect(response?.statusCode, 'synthetic patient registration').to.equal(201);
        const patientUuid: unknown = response?.body.uuid;
        if (typeof patientUuid !== 'string' || !patientUuid.trim()) {
            throw new Error('Patient registration did not return a patient UUID for ANC enrolment');
        }
        return patientUuid;
    });
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
    return registeredPatient.then((patientUuid) => patientUuid);
};

describe('ANC forms without programme enrolment', () => {
    it('keeps Initial and Follow-up hidden after starting a visit alone', () => {
        loginWithSession();
        registerMotherWithVisit();
        ancInitialForm.openClinicalForms();
        ancInitialForm.verifyAncFormVisibility(false, false);
    });
});

describe('ANC enrolment lifecycle', () => {
    let patientUuid: string | undefined;
    const enrolmentUuids: string[] = [];

    afterEach(() => {
        enrolmentUuids.forEach((uuid) => {
            cy.request('DELETE', `/openmrs/ws/rest/v1/programenrollment/${uuid}?reason=ANC-lifecycle-test-cleanup`);
        });
        if (patientUuid) {
            cy.request('DELETE', `/openmrs/ws/rest/v1/patient/${patientUuid}?reason=ANC-lifecycle-test-cleanup`);
        }
    });

    it('refreshes ANC availability through completion and a later-day re-enrolment without reloading the chart', () => {
        patientUuid = undefined;
        enrolmentUuids.length = 0;
        const firstEnrolled = new Date();
        firstEnrolled.setDate(firstEnrolled.getDate() - 2);
        firstEnrolled.setHours(0, 0, 0, 0);
        const initialDate = new Date(firstEnrolled);
        initialDate.setDate(initialDate.getDate() + 1);
        initialDate.setHours(12);
        const completedDate = new Date(initialDate);
        completedDate.setHours(18);

        loginWithSession();
        cy.intercept('POST', '**/ws/rest/v1/visit').as('startLifecycleVisit');
        registerMotherWithVisit().then((uuid) => {
            patientUuid = uuid;
        });
        // Keep the historical Initial encounter inside its visit, using real past dates.
        cy.wait('@startLifecycleVisit').then(({ response }) => {
            expect(response?.statusCode, 'start lifecycle visit').to.equal(201);
            const visitUuid: unknown = response?.body.uuid;
            expect(visitUuid, 'lifecycle visit UUID').to.be.a('string').and.not.be.empty;
            cy.request('POST', `/openmrs/ws/rest/v1/visit/${visitUuid}`, {
                startDatetime: firstEnrolled.toISOString(),
            }).its('status').should('be.oneOf', [200, 201]);
        });

        cy.window().then((chartWindow) => {
            const checkAvailability = (initial: boolean, followUp: boolean) => {
                ancInitialForm.openClinicalForms();
                ancInitialForm.verifyAncFormVisibility(initial, followUp);
                cy.window().should('equal', chartWindow);
            };

            checkAvailability(false, false);
            cy.then(() => {
                if (!patientUuid) throw new Error('Lifecycle patient was not registered');
                return enrolInAnc(patientUuid, firstEnrolled).then((saved) => {
                    enrolmentUuids.push(saved.uuid);
                    return saved;
                });
            }).then((firstEpisode) => {
                checkAvailability(true, false);
                ancInitialForm.selectForm();
                ancInitialForm.saveInitialVisit(initialDate);
                cy.get('@saveAncInitial').then(({ response }) => {
                    expect(response?.body.uuid, 'saved Initial encounter UUID').to.be.a('string').and.not.be.empty;
                    cy.request<{ encounterDatetime: string }>(
                        `/openmrs/ws/rest/v1/encounter/${response?.body.uuid}?v=full`,
                    ).its('body.encounterDatetime').then((savedDate) => {
                        const actual = new Date(savedDate);
                        expect(actual.toDateString(), 'persisted historical Initial date')
                            .to.equal(initialDate.toDateString());
                    });
                });
                checkAvailability(false, true);
                cy.request('POST', `/openmrs/ws/rest/v1/programenrollment/${firstEpisode.uuid}`, {
                    dateCompleted: completedDate.toISOString(),
                }).its('status').should('be.oneOf', [200, 201]);
                cy.request<AncEnrolment>(
                    `/openmrs/ws/rest/v1/programenrollment/${firstEpisode.uuid}?v=full`,
                ).then(({ body }) => {
                    if (!body.dateCompleted) throw new Error('Lifecycle episode completion was not persisted');
                    expect(new Date(body.dateCompleted).getTime(), 'persisted episode completion')
                        .to.equal(completedDate.getTime());
                    expect(body.voided, 'completion is not voiding').to.equal(false);
                });
                checkAvailability(false, false);
                cy.then(() => {
                    if (!patientUuid) throw new Error('Lifecycle patient was not registered');
                    return enrolInAnc(patientUuid).then((saved) => {
                        enrolmentUuids.push(saved.uuid);
                        expect(saved.uuid, 'new episode UUID').not.to.equal(firstEpisode.uuid);
                    });
                });
                checkAvailability(true, false);
            });
        });
    });
});

describe('Initial ANC Assessment form', () => {
    beforeEach(() => {
        loginWithSession();
        registerMotherWithVisit().then((patientUuid) => enrolInAnc(patientUuid));
        ancInitialForm.openClinicalForms();
    });

    it('offers Initial but not Follow-up for an enrolled female patient aged 16 to 35', () => {
        ancInitialForm.verifyAncFormVisibility(true, false);
        ancInitialForm.selectForm();
        ancInitialForm.verifyFormContract();
    });

    it('validates consistency across obstetric history fields', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyObstetricHistoryConsistency();
    });

    it('saves an ANC Initial Visit with key obstetric and maternal observations', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifySuccessfulAssessmentSaved();
        ancInitialForm.openClinicalForms();
        ancInitialForm.verifyAncFormVisibility(false, true);
    });

    it('does not save physical exam descriptions after findings are set to Normal', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyPhysicalExamDescriptionsNotSavedWhenNormal();
    });

    it('shows maternal BP warnings without blocking save', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyMaternalBpWarningsAllowSave();
    });

    it('shows the appropriate IPT field and requires a dose for Yes', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyIptConditionalFields();
    });

    it('saves with optional fetal assessment fields blank', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyOptionalFetalFieldsCanBeBlank();
    });

    it('shows warnings for non-vertex presentation and abnormal fetal heart tone', () => {
        ancInitialForm.selectForm();
        ancInitialForm.verifyFetalAssessmentWarnings();
    });
});