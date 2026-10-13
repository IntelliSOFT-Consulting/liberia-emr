import type { LocalEsm } from './local-esm';

/**
 * Stubs for Remote import and External records (LE-386, LE-387). The CI stack is one facility with
 * no central, so the facility's own endpoints that would ask central are answered here; the patient
 * the import "creates" is a real one the spec registers, so the chart opens for it.
 */

const LIBERIAEMR = '**/ws/rest/v1/liberiaemr';

/** The two apps under test, until distro.properties pins builds that carry them (see local-esm.ts). */
export const REMOTE_IMPORT_APPS: Array<LocalEsm> = [
  {
    module: '@liberiaemr/esm-liberia-remote-search-app',
    dir: 'esm-liberia-remote-search-app',
    needs: 'liberia-remote-search-results',
  },
  {
    module: '@liberiaemr/esm-liberia-patient-chart-extension',
    dir: 'esm-liberia-patient-chart-extension',
    needs: 'liberia-external-records-dashboard',
  },
];

export const BARNERSVILLE = { uuid: 'e2e-facility-barnersville', name: 'Barnersville Clinic' };
export const BENSONVILLE = { uuid: 'e2e-facility-bensonville', name: 'Bensonville Hospital' };

/** A patient central holds and this facility does not, as Remote Search returns them. */
export const remotePatient = (familyName: string) => ({
  uuid: 'e2e-remote-patient',
  display: `Musu ${familyName}`,
  person: {
    display: `Musu ${familyName}`,
    gender: 'F',
    age: 29,
    birthdate: '1997-01-11T00:00:00.000+0000',
    birthdateEstimated: false,
    preferredName: { givenName: 'Musu', familyName },
  },
  identifiers: [{ identifier: '1001396', preferred: true, identifierType: { name: 'OpenMRS ID' } }],
});

/** Central is configured and answers: what the import's first step and the search need. */
export const stubCentral = (familyName: string) => {
  cy.intercept('GET', `${LIBERIAEMR}/remotesearch/status*`, { body: { enabled: true } });
  cy.intercept('GET', `${LIBERIAEMR}/remotesearch/ping*`, { body: { reachable: true } });
  cy.intercept('GET', `${LIBERIAEMR}/remotesearch?q=*`, { body: { results: [remotePatient(familyName)] } }).as(
    'remoteSearch',
  );
};

const tag = (...codes: Array<string>) => ({ tag: codes.map((code) => ({ code })) });

/** Each facility's bundle, as central sends it and this facility caches it. */
export const twoFacilityHistory = () => [
  {
    sourceFacilityUuid: BARNERSVILLE.uuid,
    sourceFacilityName: BARNERSVILLE.name,
    fetchedAt: '2026-10-09T08:00:00Z',
    bundle: {
      entry: [
        {
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'e2e-a1',
            code: { text: 'Penicillin' },
            criticality: 'high',
            reaction: [{ manifestation: [{ text: 'Rash' }] }],
            recordedDate: '2026-03-01T00:00:00Z',
          },
        },
        {
          resource: {
            resourceType: 'Condition',
            id: 'e2e-c1',
            code: { text: 'Hypertension' },
            onsetDateTime: '2025-01-01T00:00:00Z',
          },
        },
        {
          resource: {
            resourceType: 'Immunization',
            id: 'e2e-i1',
            vaccineCode: { text: 'Tetanus toxoid' },
            occurrenceDateTime: '2026-02-01T00:00:00Z',
            protocolApplied: [{ doseNumberPositiveInt: 2 }],
          },
        },
        {
          resource: {
            resourceType: 'Encounter',
            id: 'e2e-e1',
            type: [{ text: 'ANC Contact' }],
            period: { start: '2026-02-01T09:00:00Z' },
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'e2e-o1',
            meta: tag('anc-contact-summary'),
            encounter: { reference: 'Encounter/e2e-e1' },
            effectiveDateTime: '2026-02-01T09:00:00Z',
            valueQuantity: { value: 20, unit: 'weeks' },
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'e2e-o2',
            meta: tag('anc-contact-summary', 'anc-risk-flag'),
            encounter: { reference: 'Encounter/e2e-e1' },
            effectiveDateTime: '2026-02-01T09:00:00Z',
            valueString: 'ANC Danger Sign: High systolic BP',
          },
        },
      ],
    },
  },
  {
    sourceFacilityUuid: BENSONVILLE.uuid,
    sourceFacilityName: BENSONVILLE.name,
    fetchedAt: '2026-10-09T08:00:00Z',
    bundle: {
      entry: [
        {
          resource: {
            resourceType: 'MedicationRequest',
            id: 'e2e-m1',
            medicationCodeableConcept: { text: 'Ferrous sulphate 200mg' },
            dosageInstruction: [{ text: '200 mg once daily' }],
            authoredOn: '2026-04-01T00:00:00Z',
          },
        },
        {
          resource: {
            resourceType: 'Encounter',
            id: 'e2e-e2',
            type: [{ text: 'OPD Visit' }],
            period: { start: '2026-04-01T09:00:00Z' },
          },
        },
      ],
    },
  },
];

export type LocalHistory = {
  status: 'fresh' | 'stale' | 'offline' | 'notRetrieved';
  fetchedAt: string | null;
  sources: Array<unknown>;
};

/** This facility's cached copy of the patient's history (`GET remotehistory/local/{uuid}`). */
export const stubLocalHistory = (patientUuid: string, history: LocalHistory) =>
  cy
    .intercept('GET', `${LIBERIAEMR}/remotehistory/local/${patientUuid}*`, {
      body: {
        patientUuid,
        imported: true,
        centralReachable: history.status === 'fresh',
        ageSeconds: history.fetchedAt ? 60 : null,
        ...history,
      },
    })
    .as('localHistory');

/** What `POST remotehistory/local/{uuid}/refresh` answers. */
export const refreshAnswer = (retrieved: boolean, fetchedAt: string | null) => ({
  attempt: retrieved ? 'ok' : 'unreachable',
  history: retrieved ? 'retrieved' : 'notRetrieved',
  status: retrieved ? 'fresh' : 'stale',
  facilityCount: retrieved ? 2 : 0,
  fetchedAt,
});
