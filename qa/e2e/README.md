# End-to-end tests (Cypress)

Browser tests against a fully launched distribution.

## Specs

In `cypress/e2e/`, with page objects in `cypress/pages/` and synthetic data from
`cypress/support/faker.ts`.

Family Planning quarantine (LE-568): `reveals implant sections when implants are
dispensed only, and Pregnancy only once chosen` is temporarily `it.skip` after a
dropdown detached during click in [CI run 39038512933](https://github.com/IntelliSOFT-Consulting/liberia-emr/actions/runs/39038512933).
The no-chosen-method transition described below is therefore not currently exercised.
Re-enable this scenario after investigating and verifying the dropdown interaction.

Family Planning method-gating quarantine (LE-610): `gates method-specific sections by
chosen and dispensed method` is temporarily `it.skip` after the dispensed-method options
could not be found in [CI run 39611495493](https://github.com/IntelliSOFT-Consulting/liberia-emr/actions/runs/39611495493).
Its assertions are preserved, but green CI does not verify this scenario's chosen-method
gate matrix, dispensed-implant transition, or exclusion of LAM from dispensed options.
After deployment, revisit alongside the other quarantined scenarios on a metadata-complete
non-production instance using synthetic patients. Verify the dropdown's expanded state and
actual listbox, repair the interaction as needed, remove `it.skip`, and rerun the scenario
and full Family Planning spec without weakening the clinical assertions.

| Spec | Covers |
| --- | --- |
| `Registration.cy.ts` | Login page and home page; registration required-field errors, name-known and date-of-birth-known toggles, future birthdate, request payload, 400/409/500 error dialogs, double submit (POST stubbed with `cy.intercept`); one registration against the live backend |
| `Visit.cy.ts` | Start a visit after registering a patient; end it |
| `ANCEnrolmentHelper.cy.ts` | Shared ANC enrolment helper: register synthetic patients, create and read back current and explicitly dated enrolments, then void test enrolments and patients |
| `ANCInitialAssessment.cy.ts` | Visit alone leaves both ANC forms hidden; an enrolled synthetic patient sees Initial but not Follow-up; saving Initial switches availability to Follow-up. Retains form-contract, obstetric-history, save, physical-exam, BP, IPT and fetal-assessment checks |
| `OPDConsultation.cy.ts` | OPD consultation form: contract; automatic First Visit and subsequent Follow-up Visit categories with manual override; read-only logged-in clinician and session location, including save payload and persisted encounter; clinician editable for backdated encounters only; vitals inputs and validation, BMI, general and systemic examination toggles, follow-up date, referral fields, complete save. Auto-capture assertions target the form 2.1 behavior introduced by LE-389 |
| `TBScreening.cy.ts` | TB Screening form: required radio groups and score, negative and mixed screenings, previous-treatment date, both saves |
| `LabourDelivery.cy.ts` | 1. First and Second Stage of Labor and Delivery form, for women aged 18–40: required Gravida, Parity and Delivery method; save with required fields only; ANC Gravida/Parity pre-fill and edited-value saves; Repair required for an episiotomy or laceration; Parity not above Gravida; SpO2, BP and fetal heart rate boundaries; Partograph admission and cervical-dilation prerequisites |
| `FourthStage.cy.ts` | Fourth-stage BP and pulse integer ranges, field-local errors, correction and blocked saves; observation time uses the native time input selected by the field-level `datePickerFormat: "timer"` and is checked in the encounter save payload |
| `FamilyPlanning.cy.ts` | Family Planning: one patient and visit, with the form reopened between independently missing client type, counselling, and purpose (with counselling Yes) checks; no encounter save request, and a visible field-specific error for client type and counselling (purpose shows none yet — known defect). One patient saves New then Continuing client with counselling No, asserting all downstream sections hidden and only the client-type and counselling No observations submitted. Counselling Yes shows Purpose, Parity, Obstetric Profile and Method Record while method-specific sections stay hidden, then saving without purpose sends no request. Iterates every chosen method and asserts Pregnancy Assessment, LAM and implant section gates, that a dispensed implant opens the implant sections, and that LAM is not a dispensed option. With no chosen method, dispensing implants reveals the implant sections but not Pregnancy Assessment; choosing implants then adds Pregnancy Assessment. The clinical decision-support scenarios share one patient registered once: implant insertion date required and no future dates, implant screening warning precedence, negative-pregnancy-test guidance per method, emergency-contraception day thresholds and invalid day counts, the read-only repeat pregnancy test date (today + 21) and its removal, and LAM eligibility at the six-month boundary (real dates; forced month/year rollover and month-end cases are follow-ups). Positive path: a fully completed implant visit (including method removal, pregnancy assessment and implant screening) saves, and every answered field is checked in the save request. Initial form-contract test remains pending |
| `Queue.cy.ts` | Add a patient to the queue from home-page search — **`it.skip`**: the `--demo` Careysburg content has no queue services configured |
| `IndicatorReports.cy.ts` | Indicator report runner: menu entry, fixed facility location and data freshness, run → completed → figures by disaggregation → CSV download — runs against the EMR-Ops report, the one registered on the demo stack today; see [Indicator reports](#indicator-reports) |
| `AuditLog.cy.ts` | ICT Auditor audit log viewer (MOH ICT SOP B3): creates an ICT Auditor and a Sync Conflict Reviewer; the admin changes a global property and a location over REST; the auditor finds both with old and new values (API and page), downloads the CSV; the Sync Conflict Reviewer has no menu entry and gets `403`. Until `@liberiaemr/esm-liberia-audit-log-app` is pinned, it loads `packages/esm-liberia-audit-log-app/dist/` into the page (build it first: `yarn install && yarn build` there) |
| `RoleSignIn.cy.ts` | Every login role signs in to O3 (MOH ICT SOP B2): for each of the ten roles in `ROLES`, a user holding that role alone signs in through the login page and location picker and stays on the home page with `user.person` in the session; the clinical roles and the Sync Conflict Reviewer read persons, the others get `403`; a role without `Get People` sees only its own person in the session; sampled reads (obs refused for the Records Officer, who is outside the module matrix; a filtered obs search for the Pharmacist, who may read TB Screening but not Laboratory; patients refused for the national roles). Shares `cypress/support/users.ts` with `AuditLog.cy.ts` |
| `ExternalRecords.cy.ts` | Remote import and External records (LE-386, LE-387), with central's answers stubbed at the facility endpoints: a Records Officer imports with a reason (Cancel sends nothing; the progress dialog takes focus and reports progress; the import and history requests carry the reason) and lands on the chart; a Clinician without the import privilege sees the hint and no button; a Clinician sees the banner tag, the summary card and the read-only dashboard with its facility filter; the status bar neither takes focus nor closes on Escape; stale, offline, not retrieved, no remote history and unavailable-offline states; Refresh success and failure. Until both apps are pinned, it loads `packages/esm-liberia-remote-search-app/dist/` and `packages/esm-liberia-patient-chart-extension/dist/` into the page (build them first) |
| `MflSync.cy.ts` | MFL sync admin page (`/openmrs/spa/mfl-sync`, LE-323): status with no password field, test connection (ok and refused), dry run, Sync now with counts and run items, schedule save, a URL off the allowlist refused. Syncs from the MFL stub (`qa/api/mfl-stub/`), never the live MFL |
| `MflFacilitySwitcher.cy.ts` | Central facility switcher (LE-324), with `chooseLocation.locationTag = Health Facility` applied as an O3 temporary config: search by name and by MFL code, district and code shown, duplicate names told apart, retired facilities hidden, the session switched; without the setting the facility picker is unchanged |

`Visit`, `OPDConsultation` and `TBScreening` register a new patient in every `beforeEach`.

### Shared ANC enrolment setup

Use `enrolInAnc(patientUuid, dateEnrolled?)` from
[`cypress/support/anc-enrolment.ts`](cypress/support/anc-enrolment.ts) after authenticating
and registering a synthetic patient on the disposable demo stack. It resolves the active
`Antenatal Care` programme by exact name (no hard-coded UUID), creates an enrolment, and
reads it back to verify the patient, programme, date and active/non-voided status.
Missing or ambiguous programme metadata fails explicitly; the helper never creates metadata.

The optional date is a valid JavaScript `Date`; omitting it uses the time the helper executes.
Dates are normalized to seconds to match OpenMRS database precision:

```typescript
enrolInAnc(patientUuid);
enrolInAnc(patientUuid, new Date('2026-01-15T00:00:00.000Z'));
```

The helper yields the persisted enrolment, including its UUID for completion or cleanup.
It uses the current authenticated session without changing credentials or navigating.
It does not start a visit, select a form or automatically enrol patients in negative tests.
Call it explicitly in setup; starting a visit is not ANC programme enrolment.

ANC assessment visibility checks wait for a successful form-list response and check both
the returned forms and launcher links. Initial/Follow-up availability before and after
the initial save is checked in the existing contract/save scenarios, rather than repeating
clinical validation or saving another Initial in the same episode. Each clinical test
still uses a fresh synthetic patient and enrolment.

The lifecycle scenario in the same spec is temporarily `it.skip` (LE-610), explicitly
quarantined after [CI run 39599701038](https://github.com/IntelliSOFT-Consulting/liberia-emr/actions/runs/39599701038)
reported no second form-list request after REST-based enrolment and launcher reopening.
The ANC key-observations save scenario is also temporarily skipped (LE-610) after a
post-save launcher visibility failure; restore it after deployment to verify persistence
and the Initial-to-Follow-up transition. The other eight ANC scenarios remain enabled.
Green CI while these quarantines are present
does not verify lifecycle transitions or form-list refresh after enrolment changes.
After integration, revisit on a metadata-complete non-production instance with synthetic
patients: compare enrolment/completion through the Programs UI with REST fixture setup,
identify the expected cache invalidation, then remove `it.skip` and rerun the full lifecycle
without chart reload. Do not replace the refresh assertion with a test-only cache reset.

The quarantined scenario follows one synthetic patient through unenrolled,
enrolled, Initial saved, Follow-up available, completed, and re-enrolled states. It reopens
the Clinical forms launcher and checks each real backend response and visible links without
reloading or revisiting the chart. Enrolment/completion use REST with persisted read-back;
Initial is saved through the UI, then its synthetic encounter date is backdated through REST
and read back, because Encounter Date is hidden in the ANC form. The first visit/episode is
backdated and Initial is dated yesterday, before completion and today's re-enrolment.
Same-day re-enrolment remains outside
this scenario until episode attribution is agreed. Test enrolments and the patient are voided
afterwards. When re-enabled, missing ANC programme metadata fails the scenario explicitly.

The Labour and Delivery ANC pre-fill suite explicitly enrols its registered patient before
recording ANC Initial Visit. Other Labour and Delivery suites do not acquire an ANC
enrolment requirement; the pre-fill and edited-value persistence assertions stay unchanged.
ANC assessment tests void their synthetic enrolments and patients after each test; the
Labour/Delivery pre-fill suite does so after both shared-patient assertions have finished.

Family Planning clinical-decision-support setup verifies the counselled sections after
selecting For Commodities. Its existing bounded counselling-toggle workaround restores
that purpose if a re-render hides Method Record, before any clinical answers are entered.
Recovery is logged; it is not a substitute for testing the application's initial
conditional-section rendering.

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
