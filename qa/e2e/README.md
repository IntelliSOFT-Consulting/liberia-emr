# End-to-end tests (Cypress)

Browser tests against a fully launched distribution.

## Specs

In `cypress/e2e/`, with page objects in `cypress/pages/` and synthetic data from
`cypress/support/faker.ts`.

| Spec | Covers |
| --- | --- |
| `Registration.cy.ts` | Login page and home page; registration required-field errors, name-known and date-of-birth-known toggles, future birthdate, request payload, 400/409/500 error dialogs, double submit (POST stubbed with `cy.intercept`); one registration against the live backend |
| `Visit.cy.ts` | Start a visit after registering a patient; end it |
| `OPDConsultation.cy.ts` | OPD consultation form: contract, vitals inputs and validation, BMI, general and systemic examination toggles, follow-up date, referral fields, complete save |
| `TBScreening.cy.ts` | TB Screening form: required radio groups and score, negative and mixed screenings, previous-treatment date, both saves |
| `Queue.cy.ts` | Add a patient to the queue from home-page search — **`it.skip`**: the `--demo` Careysburg content has no queue services configured |
| `IndicatorReports.cy.ts` | Indicator report runner: menu entry, fixed facility location and data freshness, run → completed → figures by disaggregation → CSV download — runs against the EMR-Ops report, the one registered on the demo stack today; see [Indicator reports](#indicator-reports) |
| `AuditLog.cy.ts` | ICT Auditor audit log viewer (MOH ICT SOP B3): creates an ICT Auditor and a Records Officer; the admin changes a global property and a location over REST; the auditor finds both with old and new values (API and page), downloads the CSV; the Records Officer has no menu entry and gets `403`. Until `@liberiaemr/esm-liberia-audit-log-app` is pinned, it loads `packages/esm-liberia-audit-log-app/dist/` into the page (build it first: `yarn install && yarn build` there) |
| `MflSync.cy.ts` | MFL sync admin page (`/openmrs/spa/mfl-sync`, LE-323): status with no password field, test connection (ok and refused), dry run, Sync now with counts and run items, schedule save, a URL off the allowlist refused. Syncs from the MFL stub (`qa/api/mfl-stub/`), never the live MFL |
| `MflFacilitySwitcher.cy.ts` | Central facility switcher (LE-324), with `chooseLocation.locationTag = Health Facility` applied as an O3 temporary config: search by name and by MFL code, district and code shown, duplicate names told apart, retired facilities hidden, the session switched; without the setting the facility picker is unchanged |

`Visit`, `OPDConsultation` and `TBScreening` register a new patient in every `beforeEach`.

The two `Mfl*` specs need the stack started with the MFL stub overlay and its material
([qa/api/README.md](../api/README.md#mfl-sync-mfl-mfl-stub)); they sync the stub's fixture in
`before()`. `CYPRESS_MFL_STUB_URL` (default `https://localhost:18443`) is where they switch stub
scenarios, and `CYPRESS_MFL_STUB_INTERNAL_URL` (default `https://mfl-stub:8443/mfl`) is the MFL
address the backend is given.

A suspended test uses `it.skip` with a comment saying why. Cypress reports it as pending,
and the job stays green, so read the `N passing, M pending` tail rather than the check
colour. No `CYPRESS_SKIP_*` variables are set in `ci.yml` at present, and nothing reads
`RUN_LIVE_REGISTRATION`: the `ci.yml` comment saying it keeps a live registration test
skipped is stale. The live-backend registration test in `Registration.cy.ts` runs on every
CI run.

### Indicator reports

The app lists only the reports in `reportUuids` that the server has registered. On the demo
stack that is the EMR-Ops report today (`EmrOpsReportManager`, with its `indicators` data set
and CSV design; [docs/reporting/README.md](../../docs/reporting/README.md) §3.1), so the run
test runs it. The MOH indicator reports (LE-334) join the list without changing the spec.

## Running

```bash
cd qa/e2e
npm ci
CYPRESS_BASE_URL=https://localhost CYPRESS_USERNAME=admin CYPRESS_PASSWORD=Admin123 npm test
```

`npm run cy:open` opens the interactive runner instead.

| Setting | Source, in order | Notes |
| --- | --- | --- |
| Base URL | `CYPRESS_BASE_URL`, `BASE_URL`, `baseUrl` in `cypress.env.json`, then `http://localhost:8080` | Checked by `cypress.config.ts` before any spec runs |
| Host allowlist | `CYPRESS_BASE_URL_ALLOWLIST`, `BASE_URL_ALLOWLIST`, then `CYPRESS_BASE_URL_ALLOWLIST` / `baseUrlAllowlist` / `allowedBaseUrlHosts` in `cypress.env.json` | Comma-separated host names. Only `localhost`, `127.0.0.1` and `::1` pass without it |
| Credentials | `CYPRESS_USERNAME` / `CYPRESS_PASSWORD`, or `USERNAME` / `PASSWORD` in `cypress.env.json` | The run throws if either is missing |

`cypress.env.json` is gitignored and is for local development only. `admin`/`Admin123` is
the demo stack's training account ([demo-stack.md](../../docs/runbooks/demo-stack.md)).

## In CI

The `e2e` job in `ci.yml` runs on every CI run once `build-test` passes. It builds
`--demo` images with `build-distribution.sh` at `0.0.0-ci`, starts `db` and `backend` from
the facility compose files plus `docker-compose.demo.yml` with a throwaway self-signed
certificate, waits up to 30 minutes for `/openmrs/health/started`, then starts `frontend`
and `gateway` and waits up to 2 minutes for `https://localhost/openmrs/spa/`. Cypress runs
`npm test` with `CYPRESS_BASE_URL=https://localhost` and the demo credentials. Screenshots
and videos are uploaded as `cypress-artifacts` on failure; the stack is torn down with
`down -v` either way.

The stack also carries the MFL stub overlay (`qa/api/mfl-stub/docker-compose.mfl-stub.yml`):
the job runs the MFL API contract tests before Cypress. Cypress runs even when they fail.
Afterwards the job recreates the backend without MFL credentials and checks that the sync reports
itself unavailable ([qa/api/README.md](../api/README.md)).

`release.yml`'s `full-stack-tests` job has only a TODO `echo` for Cypress.

## Priority journeys — first go-live

Not yet covered by a spec, except parts of 1 (login, without choosing a location or logging
out) and 2 (registration, without asserting the MOH Health Record Number).

1. Log in, choose a facility location, log out.
2. Register a patient with an MOH Health Record Number.
3. Enrol the patient in Antenatal Care; confirm the programme and workflow state.
4. Record an ANC initial visit; confirm the encounter and observations persist.
5. Record serial partograph observations; confirm the chart plots them.
6. Record a delivery outcome and transition the ANC workflow to Delivered.
7. Record a postnatal visit.
8. Record a family planning method and a discontinuation.

## Offline

Facility instances are offline-first, so the offline path is a **primary** journey, not an
edge case: record clinical data with the network disconnected, reconnect, and confirm
nothing was lost. Test this by actually disconnecting the stack — a mocked offline mode
tests the mock.

## Rules

- No test writes to a production instance, ever. `cypress.config.ts` refuses any base URL
  host other than localhost unless it is allowlisted; never allowlist a production host.
- Tests run against the demo stack, whose data is synthetic by construction. Specs create
  patients there, so point them only at a stack you can throw away.
- A test that is flaky is deleted or fixed the week it is noticed. A suite people ignore is
  worse than no suite, because it also carries authority.
