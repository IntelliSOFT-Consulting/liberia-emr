import { loginWithSession } from '../support/session';
import { randomAdultBirthdateParts } from '../support/faker';
import VisitPage from '../pages/visit';
import PartographPage, { type PartographAssessment } from '../pages/partograph';
import LabourDeliveryFormPage from '../pages/labourDeliveryForm';

const visitPage = new VisitPage();
const partographPage = new PartographPage();
const labourDeliveryForm = new LabourDeliveryFormPage();

const registerPatientWithVisit = (sex: 'male' | 'female') => {
    visitPage.registerPatient({
        sex,
        birthdate: randomAdultBirthdateParts(18, 40),
    });
    visitPage.startVisit();
};

const saveAdmissionWithDilation = (dilation: number) => {
    registerPatientWithVisit('female');
    partographPage.openDashboard();
    partographPage.verifyAdmissionRequired();
    partographPage.openAdmissionForm();
    labourDeliveryForm.fillRequiredFields();
    labourDeliveryForm.saveAndGetObservations();
    cy.get('#gravida', { timeout: 60000 }).should('not.exist');
    cy.get('@saveLabourDelivery').its('response.body').then(
        (encounter: { uuid: string; patient: { uuid: string } }) => {
            expect(encounter.uuid, 'saved admission UUID').to.be.a('string').and.not.be.empty;
            expect(encounter.patient.uuid, 'admitted patient UUID').to.be.a('string').and.not.be.empty;
            partographPage.seedAdmissionDilation(encounter.uuid, encounter.patient.uuid, dilation);
        },
    );
    cy.reload();
};

describe('Partograph access and prerequisites', { retries: 1 }, () => {
    beforeEach(() => {
        loginWithSession();
    });

    it('opens Labour Admission for a female patient and transitions to the dilation requirement after saving', () => {
        registerPatientWithVisit('female');
        partographPage.openDashboard();
        partographPage.verifyAdmissionRequired();
        partographPage.openAdmissionForm();
        cy.contains(LabourDeliveryFormPage.formName, { timeout: 60000 }).should('be.visible');
        labourDeliveryForm.fillRequiredFields();
        labourDeliveryForm.saveAndGetObservations();
        cy.get('#gravida', { timeout: 60000 }).should('not.exist');
        labourDeliveryForm.verifyPartographDilationRequired();
        cy.contains('The Partograph is only available after').should('not.exist');
    });

    it('hides the Partograph link for a male patient and blocks monitoring on direct navigation', () => {
        registerPatientWithVisit('male');
        partographPage.verifyDashboardLinkHidden();
        partographPage.openDashboardDirectly();
        partographPage.verifyFemaleOnlyAccess();
        partographPage.verifyDashboardLinkHidden();
    });

    // The cervical-dilation concept accepts whole numbers only.
    [3, 4].forEach((dilation) => {
        it(`keeps admission at ${dilation} cm ${dilation < 4 ? 'outside' : 'inside'} active Partograph monitoring`, () => {
            saveAdmissionWithDilation(dilation);
            if (dilation < 4) {
                labourDeliveryForm.verifyPartographDilationRequired();
                partographPage.verifyMonitoringBlocked();
            } else {
                partographPage.verifyActiveMonitoring(dilation);
            }
        });

        it('saves an assessment and retains its date and observations after refreshing and reopening', () => {
            const assessment: PartographAssessment = {
                fetal_heart_rate: '140',
                cervical_dilatation: '5',
                contractions_per_10_minutes: '3',
                drugs_given_and_iv_fluids: 'No IV fluids',
            };
            saveAdmissionWithDilation(4);
            partographPage.verifyActiveMonitoring(4);
            partographPage.openAssessmentForm();
            labourDeliveryForm.setNumber('fetal_heart_rate', assessment.fetal_heart_rate);
            labourDeliveryForm.setNumber('cervical_dilatation', assessment.cervical_dilatation);
            labourDeliveryForm.setNumber('contractions_per_10_minutes', assessment.contractions_per_10_minutes);
            cy.get('#drugs_given_and_iv_fluids').scrollIntoView().type(assessment.drugs_given_and_iv_fluids).blur();
            partographPage.saveAssessment(assessment).then((encounterDatetime) => {
                cy.get('#cervical_dilatation', { timeout: 60000 }).should('not.exist');
                partographPage.verifyAssessment(assessment, encounterDatetime);
                cy.reload();
                partographPage.verifyAssessment(assessment, encounterDatetime);
                cy.contains('a', /^Patient summary$/i).click();
                partographPage.openDashboard();
                partographPage.verifyAssessment(assessment, encounterDatetime);
            });
        });
    });
});
