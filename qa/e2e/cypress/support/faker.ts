const { faker } = require('@faker-js/faker');

export type DateParts = {
    day: string;
    month: string;
    year: string;
};

export const toDateParts = (date: Date): DateParts => ({
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear())
});

export const randomAdultBirthdateParts = (minAge = 18, maxAge = 80): DateParts => {
    const dateOfBirth = faker.date.birthdate({ min: minAge, max: maxAge, mode: 'age' });
    return toDateParts(dateOfBirth);
};

export const futureBirthdateParts = (daysAhead = 1): DateParts => {
    const futureDate = faker.date.soon({ days: daysAhead });
    return toDateParts(futureDate);
};

export { faker };
