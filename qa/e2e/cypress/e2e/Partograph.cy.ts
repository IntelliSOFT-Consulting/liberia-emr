import { loginWithSession } from '../support/session';
import { randomAdultBirthdateParts } from '../support/faker';
import VisitPage from '../pages/visit';
import PartographPage from '../pages/partograph';
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
            if (dilation < 4) {
                labourDeliveryForm.verifyPartographDilationRequired();
                partographPage.verifyMonitoringBlocked();
            } else {
                partographPage.verifyActiveMonitoring(dilation);
            }
        });
    });
});
