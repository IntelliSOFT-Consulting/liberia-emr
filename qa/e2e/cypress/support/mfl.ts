// Helpers for the MFL sync specs (LE-325). The backend under test syncs from the stub in
// qa/api/mfl-stub/, never from the live MOH MFL. The contract is docs/architecture/mfl-sync-api.md.

const MFL = '/openmrs/ws/rest/v1/liberiaemr/mfl';

// UUIDv5(e0b0fbf7-045c-437a-8e7c-4504984c5e1a, MFL UID): the UUID the sync gives a row it
// creates (ADR 0009 §1). Precomputed, so the specs need no SHA-1 in the browser.
export const mflLocation = {
  jahClinic: '7dd5a981-7e3a-59fa-b1fa-e1474e299da8', // nY6mPgT0Kc6, code LBR-06-0624-06, Kpaai
  kesselee: '3a01b4f7-8994-517e-9a47-fe1f38e4cd39', // VxgfT09KRV4, LBR-30-3002-02, Careysburg District
  jamaicaActive: 'efac7849-9788-51b7-97a2-cc27785ccc3f', // ZktsAIReh6z, Somalia Drive District
};

const credentials = () =>
  cy.env<{ USERNAME?: string; PASSWORD?: string }>(['USERNAME', 'PASSWORD']).then(({ USERNAME, PASSWORD }) => {
    if (!USERNAME || !PASSWORD) {
      throw new Error('Missing Cypress credentials: set CYPRESS_USERNAME/CYPRESS_PASSWORD');
    }
    // cy.request's auth takes username/password; any other keys send no Authorization header.
    return { username: USERNAME, password: PASSWORD };
  });

// The MFL URL as the backend reaches the stub, and where the tests reach the stub's control API.
export const stubInternalUrl = () =>
  cy.env<{ MFL_STUB_INTERNAL_URL?: string }>(['MFL_STUB_INTERNAL_URL']).then(
    ({ MFL_STUB_INTERNAL_URL }) => MFL_STUB_INTERNAL_URL ?? 'https://mfl-stub:8443/mfl',
  );
const stubControlUrl = () =>
  cy.env<{ MFL_STUB_URL?: string }>(['MFL_STUB_URL']).then(({ MFL_STUB_URL }) => MFL_STUB_URL ?? 'https://localhost:18443');

export const mflApi = (method: string, path: string, body?: Cypress.RequestBody, failOnStatusCode = true) =>
  credentials().then((auth) =>
    cy.request({ method, url: `${MFL}${path}`, body, auth, failOnStatusCode, headers: { Accept: 'application/json' } }),
  );

export const stubScenario = (name: string) =>
  stubControlUrl().then((url) => cy.request('POST', `${url}/__stub/scenario`, { name, delayMs: 0 }));

type MflRun = Record<string, any>;

const waitForRun = (id: number, attempts = 150): Cypress.Chainable<MflRun> =>
  mflApi('GET', `/runs/${id}`).then((r): Cypress.Chainable<MflRun> => {
    if (r.body.status !== 'RUNNING') {
      return cy.wrap<MflRun>(r.body);
    }
    if (attempts <= 0) {
      throw new Error(`MFL run ${id} still RUNNING`);
    }
    return cy.wait(2000).then(() => waitForRun(id, attempts - 1));
  });

/** Point the sync at the stub (never the live MFL) and run one full, real sync of the fixture. */
export const syncFixture = () => {
  stubScenario('normal');
  stubInternalUrl().then((url) => {
    mflApi('PUT', '/config', { url, enabled: false }).its('body.config.url').should('eq', url);
  });
  return mflApi('POST', '/runs', { dryRun: false }).then((r) => {
    expect(r.status).to.eq(202);
    return waitForRun(r.body.id).then((run) => {
      expect(run.status, 'the fixture sync').to.be.oneOf(['SUCCEEDED', 'PARTIAL']);
      return run;
    });
  });
};

export { waitForRun };
