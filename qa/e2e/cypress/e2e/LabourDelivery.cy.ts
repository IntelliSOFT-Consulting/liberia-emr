import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import LabourDeliveryFormPage from '../pages/labourDeliveryForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const labourDeliveryForm = new LabourDeliveryFormPage();

// Every test is for a woman of childbearing age; age-specific behaviour is out of scope here.
const registerMotherWithVisit = () => {
    registrationPage.visitPage();
    registrationPage.fillRequiredFields({
        firstName: faker.person.firstName('female'),
        familyName: faker.person.lastName(),
        sex: 'female',
        birthdate: randomAdultBirthdateParts(18, 40),
        phoneNumber: liberiaPhoneNumber()
    });
    registrationPage.clickRegisterPatient();
    cy.url({ timeout: 100000 }).should('include', '/openmrs/spa/patient/');
    cy.get('[data-extension-slot-name="patient-chart-summary-dashboard-slot"]', { timeout: 30000 })
        .should('be.visible');
    visitPage.startVisit();
};

const openLabourDeliveryForm = () => {
    labourDeliveryForm.openClinicalForms();
    labourDeliveryForm.selectForm();
};

describe('First and Second Stage of Labor and Delivery form (one shared patient)', () => {
    let patientChartUrl: string;

    before(() => {
        loginWithSession();
        registerMotherWithVisit();
        cy.url().then((url) => {
            patientChartUrl = url;
        });
    });

    beforeEach(() => {
        loginWithSession();
        cy.visit(patientChartUrl);
        openLabourDeliveryForm();
    });

    describe('required fields', () => {
        it('blocks saving without Gravida', () => {
            labourDeliveryForm.setNumber('parity', '1');
            labourDeliveryForm.selectDeliveryMethod('Spontaneous vaginal delivery (SVD)');
            labourDeliveryForm.clearNumber('gravida');
            labourDeliveryForm.verifySaveBlocked();
            labourDeliveryForm.verifyRequiredError('gravida');
        });

        it('blocks saving without Parity', () => {
            labourDeliveryForm.setNumber('gravida', '2');
            labourDeliveryForm.selectDeliveryMethod('Spontaneous vaginal delivery (SVD)');
            labourDeliveryForm.clearNumber('parity');
            labourDeliveryForm.verifySaveBlocked();
            labourDeliveryForm.verifyRequiredError('parity');
        });

        it('blocks saving without a Delivery method', () => {
            labourDeliveryForm.setNumber('gravida', '2');
            labourDeliveryForm.setNumber('parity', '1');
            labourDeliveryForm.verifySaveBlocked();
            labourDeliveryForm.verifyRequiredError('delivery_method');
        });

        it('saves with only the required fields answered', () => {
            labourDeliveryForm.fillRequiredFields();
            labourDeliveryForm.saveAndGetObservations().then((observations) => {
                expect(Number(labourDeliveryForm.observationValue(observations, 'gravida')), 'saved Gravida').to.equal(2);
                expect(Number(labourDeliveryForm.observationValue(observations, 'parity')), 'saved Parity').to.equal(1);
                expect(labourDeliveryForm.observationValue(observations, 'delivery_method'), 'saved Delivery method')
                    .to.be.a('string').and.not.be.empty;
            });
        });
    });
});
