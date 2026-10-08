import { loginWithSession } from '../support/session';
import { faker, liberiaPhoneNumber, randomAdultBirthdateParts } from '../support/faker';
import RegistrationPage from '../pages/Registration';
import VisitPage from '../pages/visit';
import LabourDeliveryFormPage from '../pages/labourDeliveryForm';
import ANCInitialFormPage from '../pages/ancInitialForm';

const registrationPage = new RegistrationPage();
const visitPage = new VisitPage();
const labourDeliveryForm = new LabourDeliveryFormPage();
const ancInitialForm = new ANCInitialFormPage();

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

        describe('Gravida and Parity validation', () => {
            it('rejects Gravida 0 but accepts 1 despite the "greater than 1" message', () => {
                labourDeliveryForm.fillRequiredFields('0', '0');
                labourDeliveryForm.verifySaveBlocked();

                labourDeliveryForm.setNumber('gravida', '1');
                labourDeliveryForm.saveAndGetObservations().then((observations) => {
                    expect(Number(labourDeliveryForm.observationValue(observations, 'gravida')), 'saved Gravida').to.equal(1);
                });
            });

            it('accepts Parity equal to Gravida', () => {
                labourDeliveryForm.fillRequiredFields('2', '2');
                labourDeliveryForm.saveAndGetObservations().then((observations) => {
                    expect(Number(labourDeliveryForm.observationValue(observations, 'gravida')), 'saved Gravida').to.equal(2);
                    expect(Number(labourDeliveryForm.observationValue(observations, 'parity')), 'saved Parity').to.equal(2);
                });
            });

            it('blocks saving when Parity is greater than Gravida', () => {
                labourDeliveryForm.fillRequiredFields('1', '2');
                labourDeliveryForm.verifyMessageShown(LabourDeliveryFormPage.messages.parityAboveGravida);
                labourDeliveryForm.verifySaveBlocked();
            });

            it('shows the Parity error when Gravida is lowered below it and clears it when Gravida is raised', () => {
                labourDeliveryForm.fillRequiredFields('2', '2');
                labourDeliveryForm.setNumber('gravida', '1');
                labourDeliveryForm.verifyMessageShown(LabourDeliveryFormPage.messages.parityAboveGravida);

                labourDeliveryForm.setNumber('gravida', '3');
                labourDeliveryForm.verifyMessageAbsent(LabourDeliveryFormPage.messages.parityAboveGravida);
            });

            it('rejects decimal and negative values for Gravida and Parity', () => {
                labourDeliveryForm.fillRequiredFields('1', '0');

                labourDeliveryForm.setNumber('gravida', '1.5');
                labourDeliveryForm.verifySaveBlocked();
                labourDeliveryForm.setNumber('gravida', '1');

                labourDeliveryForm.setNumber('parity', '0.5');
                labourDeliveryForm.verifySaveBlocked();
                labourDeliveryForm.setNumber('parity', '0');

                labourDeliveryForm.setNumber('gravida', '-1');
                labourDeliveryForm.verifySaveBlocked();
                labourDeliveryForm.setNumber('gravida', '1');

                labourDeliveryForm.setNumber('parity', '-1');
                labourDeliveryForm.verifySaveBlocked();
            });
        });
    });
});

describe('First and Second Stage of Labor and Delivery form ANC pre-fill', () => {
    let patientChartUrl: string;

    before(() => {
        loginWithSession();
        registerMotherWithVisit();

        ancInitialForm.openClinicalForms();
        ancInitialForm.selectForm();
        ancInitialForm.saveInitialVisit();
        cy.url().then((url) => {
            patientChartUrl = url;
        });
    });

    beforeEach(() => {
        loginWithSession();
        cy.visit(patientChartUrl);
        openLabourDeliveryForm();
    });

    it('pre-fills Gravida and Parity from the ANC Initial Visit', () => {
        labourDeliveryForm.verifyNumberValue('gravida', '2');
        labourDeliveryForm.verifyNumberValue('parity', '1');
    });

    it('allows editing pre-filled Gravida and Parity and saves the edited values', () => {
        labourDeliveryForm.verifyNumberValue('gravida', '2');
        labourDeliveryForm.verifyNumberValue('parity', '1');
        labourDeliveryForm.fillRequiredFields('3', '2');

        labourDeliveryForm.saveAndGetObservations().then((observations) => {
            expect(Number(labourDeliveryForm.observationValue(observations, 'gravida')), 'saved Gravida').to.equal(3);
            expect(Number(labourDeliveryForm.observationValue(observations, 'parity')), 'saved Parity').to.equal(2);
        });
    });
});

describe('First and Second Stage of Labor and Delivery form vital-sign ranges (one shared patient)', () => {
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

    const expectNumericValueSaved = (fieldId: string, value: string) => {
        labourDeliveryForm.fillRequiredFields();
        labourDeliveryForm.setNumber(fieldId, value);
        labourDeliveryForm.saveAndGetObservations().then((observations) => {
            expect(Number(labourDeliveryForm.observationValue(observations, fieldId)), `saved ${fieldId}`)
                .to.equal(Number(value));
        });
    };

    const expectNumericValueRejected = (fieldId: string, value: string, message: string) => {
        labourDeliveryForm.fillRequiredFields();
        labourDeliveryForm.setNumber(fieldId, value);
        labourDeliveryForm.verifyMessageShown(message);
        labourDeliveryForm.verifySaveBlocked();
    };

    describe('SpO2 range', () => {
        it('saves SpO2 at the lower bound of 0', () => {
            expectNumericValueSaved('spo2', '0');
        });

        it('saves SpO2 at the upper bound of 100', () => {
            expectNumericValueSaved('spo2', '100');
        });

        it('rejects SpO2 below the range at -1', () => {
            expectNumericValueRejected('spo2', '-1', LabourDeliveryFormPage.messages.spo2Range);
        });

        it('rejects SpO2 above the range at 101', () => {
            expectNumericValueRejected('spo2', '101', LabourDeliveryFormPage.messages.spo2Range);
        });
    });

    describe('Blood pressure ranges', () => {
        it('saves systolic blood pressure at the upper bound of 250', () => {
            expectNumericValueSaved('bp_sys', '250');
        });

        it('rejects systolic blood pressure above the range at 251', () => {
            expectNumericValueRejected('bp_sys', '251', LabourDeliveryFormPage.messages.systolicRange);
        });

        it('saves diastolic blood pressure at the upper bound of 150', () => {
            expectNumericValueSaved('bp_dia', '150');
        });

        it('rejects diastolic blood pressure above the range at 151', () => {
            expectNumericValueRejected('bp_dia', '151', LabourDeliveryFormPage.messages.diastolicRange);
        });
    });

    describe('Fetal heart rate range', () => {
        it('saves fetal heart rate at the lower bound of 60', () => {
            expectNumericValueSaved('fhr', '60');
        });

        it('saves fetal heart rate at the upper bound of 219', () => {
            expectNumericValueSaved('fhr', '219');
        });

        it('rejects fetal heart rate below the range at 59', () => {
            expectNumericValueRejected('fhr', '59', LabourDeliveryFormPage.messages.fetalHeartRateLowerRange);
        });

        it('rejects fetal heart rate at 220 because the value must be lower than 220', () => {
            expectNumericValueRejected('fhr', '220', LabourDeliveryFormPage.messages.fetalHeartRateUpperRange);
        });

        it('rejects fetal heart rate above the range at 221', () => {
            expectNumericValueRejected('fhr', '221', LabourDeliveryFormPage.messages.fetalHeartRateUpperRange);
        });
    });
});
