import RegistrationPage from './Registration';
import { faker, randomAdultBirthdateParts } from '../support/faker';

class VisitPage {
    private registrationPage = new RegistrationPage();

    // Minimal setup so a visit test has a patient to work with — not itself a registration test.
    registerPatient() {
        this.registrationPage.visitPage();
        this.registrationPage.fillRequiredFields({
            firstName: faker.person.firstName(),
            familyName: faker.person.lastName(),
            sex: faker.helpers.arrayElement(['male', 'female'] as const),
            birthdate: randomAdultBirthdateParts()
        });
        this.registrationPage.clickRegisterPatient();
    }

    startVisit() {
    }
}

export default VisitPage;
