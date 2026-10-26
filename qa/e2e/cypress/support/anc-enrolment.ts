const REST = '/openmrs/ws/rest/v1';

type Program = { uuid: string; name: string; retired: boolean };

export type AncEnrolment = {
    uuid: string;
    patient: { uuid: string };
    program: { uuid: string };
    dateEnrolled: string;
    dateCompleted: string | null;
    voided: boolean;
};

/** Uses the current authenticated session; the caller supplies a synthetic test patient. */
export const enrolInAnc = (
    patientUuid: string,
    dateEnrolled?: Date,
): Cypress.Chainable<AncEnrolment> => cy.then(() => {
    if (!patientUuid.trim()) {
        throw new Error('ANC enrolment requires a synthetic patient UUID');
    }
    const date = dateEnrolled ?? new Date();
    if (!Number.isFinite(date.getTime())) {
        throw new Error('ANC enrolment requires a valid enrolment date');
    }
    // OpenMRS stores patient_program dates at second precision.
    const expectedTime = Math.floor(date.getTime() / 1000) * 1000;
    const when = new Date(expectedTime).toISOString();

    return cy.request<{ results: Program[] }>(
        `${REST}/program?v=custom:(uuid,name,retired)&limit=100`,
    ).then(({ body }) => {
        const programs = body.results.filter((program) => program.name === 'Antenatal Care' && !program.retired);
        expect(programs, 'exactly one active Antenatal Care programme; load MCH programme metadata first')
            .to.have.length(1);
        const programUuid = programs[0].uuid;

        return cy.request<{ uuid: string }>({
            method: 'POST',
            url: `${REST}/programenrollment`,
            body: { patient: patientUuid, program: programUuid, dateEnrolled: when },
        }).then(({ status, body: created }) => {
            expect(status, 'create ANC enrolment status').to.be.oneOf([200, 201]);
            expect(created.uuid, 'created ANC enrolment UUID').to.be.a('string').and.not.be.empty;

            return cy.request<AncEnrolment>(
                `${REST}/programenrollment/${created.uuid}?v=full`,
            ).then(({ body: saved }) => {
                expect(saved.uuid, 'persisted enrolment UUID').to.equal(created.uuid);
                expect(saved.patient.uuid, 'enrolled patient').to.equal(patientUuid);
                expect(saved.program.uuid, 'ANC programme').to.equal(programUuid);
                expect(new Date(saved.dateEnrolled).getTime(), 'persisted enrolment date').to.equal(expectedTime);
                expect(saved.dateCompleted, 'active enrolment completion date').to.be.null;
                expect(saved.voided, 'non-voided enrolment').to.equal(false);
                return saved;
            });
        });
    });
});
