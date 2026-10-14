# LE-560: generic vaccine eligibility foundation

Decision: **B — utility/test layer only**. This is not a completed clinical workflow.
No schedule is configured, exported from the ESM entrypoint, registered with the
form engine, or connected to a save endpoint. Clinical clarification changes data
rather than date/evaluation logic. The existing patient-chart extension already
hosts pure TypeScript clinical helpers and Node tests, making it a suitable home
without introducing another ESM, a shared-package build system, or an upstream fork.

## Current architecture

- `distribution/distro.properties` pins immunizations and form-engine ESMs at
  12.3.4 and FHIR2 at 4.2.0.
- `distribution/frontend/config/config-national.json` configures immunization
  visibility, not eligibility. No local `sequenceDefinitions` override was found.
- `content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/immunization-national.json`
  on main is version 1.1: standalone coded vaccine Obs, completed-years visibility
  conditions, and a manually entered return-date Obs. It has no structured dose
  group, schedule, prior-dose lookup, or duplicate guard.
- `packages/esm-liberia-patient-chart-extension/src/index.ts` registers custom
  widgets and form-engine expression helpers. These expression helpers do not
  intercept the separate O3 immunization workspace.
- `src/forms/who-whz.ts` in that package contains date/age helpers for nutrition.
  Its completed-month calculation follows SQL-style day comparison (Jan 31 to
  Feb 28 is zero months), which is intentionally different from adding a
  calendar-month schedule offset with month-end clamping. Do not change it for
  immunizations. Partograph overdue indicators likewise have a different purpose;
  there is no shared vaccination rule engine in this repository.
- `modules/liberiaemr/omod/src/main/java/org/openmrs/module/liberiaemr/web/remotehistory/RemoteHistoryService.java`
  reads immunization-history Obs groups. Its `RemoteHistoryAssembler` emits
  vaccine and occurrence date but **omits protocolApplied/dose number**. Its
  summary cannot establish dose-specific eligibility or absence of a duplicate.

Exact upstream source inspected from the published 12.3.4 npm package (gitHead
`14c02bf7d7e6ec41445141c813e595e2316746b6`):

- [O3 config schema](https://github.com/openmrs/openmrs-esm-patient-chart/blob/14c02bf7d7e6ec41445141c813e595e2316746b6/packages/esm-patient-immunizations-app/src/config-schema.ts):
  vaccine concept set plus sequence label/number only; no age, interval, upper
  bound, or overdue configuration. Dose numbering is positive, with booster
  convention 11–19. Clinical name OPV0 must not be assumed to mean FHIR sequence
  zero; this mapping needs explicit configuration.
- [History hook](https://github.com/openmrs/openmrs-esm-patient-chart/blob/14c02bf7d7e6ec41445141c813e595e2316746b6/packages/esm-patient-immunizations-app/src/hooks/useImmunizations.ts):
  uses `useFhirFetchAll` on `/Immunization?patient=...`.
- [Mapper](https://github.com/openmrs/openmrs-esm-patient-chart/blob/14c02bf7d7e6ec41445141c813e595e2316746b6/packages/esm-patient-immunizations-app/src/immunizations/immunization-mapper.ts):
  vaccine UUID from coding without a system, dose from
  `protocolApplied[0].doseNumberPositiveInt`, date from `occurrenceDateTime`, ID
  from resource ID. Return date uses an extension, not a derived schedule.
- [Workspace](https://github.com/openmrs/openmrs-esm-patient-chart/blob/14c02bf7d7e6ec41445141c813e595e2316746b6/packages/esm-patient-immunizations-app/src/immunizations/immunizations-form.workspace.tsx):
  validates date against DOB/today, watches vaccine/dose/date, displays duplicate
  warning excluding the record being edited, but does not block duplicate save.
  No eligibility extension slot/callback was found in its submit path. A status
  widget alone would not enforce that path. Browser-local start-of-day handling
  also needs attention when integrating a facility-calendar evaluator.
- [FHIR2 service](https://github.com/openmrs/openmrs-module-fhir2/blob/4.2.0/api/src/main/java/org/openmrs/module/fhir2/api/impl/FhirImmunizationServiceImpl.java)
  translates to Obs, validates, then saves through ObsService; create may also
  save an encounter. Updates use ObsService too.
- [FHIR2 translator](https://github.com/openmrs/openmrs-module-fhir2/blob/4.2.0/api/src/main/java/org/openmrs/module/fhir2/api/translators/impl/ImmunizationTranslatorImpl.java)
  maps group CIEL:1421, vaccine CIEL:984, date CIEL:1410, dose CIEL:1418, and
  next-dose date CIEL:170000.
- [FHIR2 group helper](https://github.com/openmrs/openmrs-module-fhir2/blob/4.2.0/api/src/main/java/org/openmrs/module/fhir2/api/util/ImmunizationObsGroupHelper.java)
  validates group structure, not atomic cross-record uniqueness.

## Responsibility split

| Responsibility | Location / decision |
| --- | --- |
| Clinical schedule | Approved national content/runtime configuration, with UUID variables and versioning |
| Pure eligibility | `src/immunizations/eligibility.ts` in the patient-chart extension for now |
| Status/age display | O3 chart extension or upstream immunizations UI integration |
| Immediate save prevention | Workspace validation using entered vaccination date and fully loaded history; recheck on submit |
| Authoritative validation | Backend service transaction covering all accepted write paths |
| Atomic duplicate prevention | Backend locking/unique-key design, still unresolved |

Configuration alone cannot implement LE-560 in the pinned O3 release. Prefer an
upstream eligibility/validation extension point over copying its workspace; a
community modification must follow the repository's Modify + PR policy. The
local backend module has transactional services and service-interceptor wiring;
these are extension patterns, **not an existing immunization uniqueness facility**.
A FHIR interceptor alone would miss direct Obs/encounter writes and sync imports.
A read-before-write duplicate check, including one in a validator, can race.
Choose a locked transaction or a dedicated normalized unique-key mechanism and
test concurrent create/update/void paths. Ordinary Obs rows cannot carry a simple
patient + vaccine + dose unique constraint because those values span a group.
Offline facility concurrency and central sync conflict handling require separate
decisions; a facility lock cannot guarantee cross-facility uniqueness.

## Rule and status model

The model has vaccine concept UUID, positive sequence number, `dueAge: {value, unit}`,
optional upper age with **explicit inclusivity**, optional single prerequisite
identity and minimum interval, and required `overdueAfterDays: number | null`.
Display labels belong in configuration, not the evaluator. Duplicate identity
reuses vaccine + sequence; no independent duplicate key is needed yet.
Cross-vaccine equivalences, multiple prerequisites, and other clinical exclusions
need requirements before extending the model.

A finite eligibility window is an upper age. An inclusive upper equal to the due
date permits only that date. An omitted upper bound means unbounded **in this
utility**, not approval of unlimited catch-up for any real vaccine. Do not use
omission to represent a clinically unresolved limit. There is no catch-up boolean:
that flag overlapped with the upper boundary and could close a window that upper
age had left open. The future configuration loader must withhold
incomplete/unapproved rules rather than turn uncertainty into permission.

Rule validation rejects an upper date before the due date, and an exclusive upper
equal to the due date, because that window contains no eligible day.

Evaluation precedence after input validation:

1. Any matching record in the supplied history, including one dated after the
   evaluation date → `ADMINISTERED`, cannot administer. Editing excludes only
   that record's own ID; another matching record still yields `ADMINISTERED`.
2. Evaluation date beyond the configured upper boundary → `NOT_ELIGIBLE`.
3. Before the DOB-derived scheduled date → `NOT_YET_DUE`.
4. No prerequisite administered on or before the evaluation date →
   `WAITING_FOR_PREREQUISITE`.
5. Prerequisite interval date beyond the upper boundary → `NOT_ELIGIBLE`.
   Waiting cannot produce an eligible day. This applies to a date strictly after
   an inclusive upper bound and to a date on or after an exclusive upper bound.
6. Required interval has not elapsed, and that interval date is still inside the
   upper boundary → `WAITING_FOR_INTERVAL`.
7. Otherwise `DUE`, or `OVERDUE` if the evaluation date is strictly after the
   scheduled date plus the explicitly supplied grace days. Both allow administration.

No overdue policy existed in the inspected configuration. Therefore no clinical
default is chosen: null retains DUE, zero means overdue the next day, N means due
through scheduled date + N days. This status threshold does not shift when a
prerequisite is late; its interval independently gates administration.
Output includes scheduled due date, interval date when known, matching IDs and
`canAdminister`. Invalid dates, missing policies, unavailable history, or ambiguous
multiple prerequisite records throw; a future caller must display an unresolved
state and prevent save, never interpret errors as eligibility.

## Date semantics

Inputs are complete Gregorian `YYYY-MM-DD` calendar dates. No implicit clock,
browser timezone, completed-years age, partial DOB, or timestamp parsing is used.
Days add calendar days; weeks add seven calendar days; months add calendar months
and clamp to the target month's last day; years add twelve calendar months.
Every due/upper date is derived directly from DOB, avoiding accumulated clamp
drift. Jan 31 + 1 month is Feb 28/29; + 2 months is Mar 31; Feb 29 + 1 year is
Feb 28. A zero-day due offset is due on the date of birth. These are documented
arithmetic choices, not resolved clinical limits.

UTC setters implement calendar arithmetic without local DST. The adapter must
preserve DOB's date-only meaning and convert administration timestamps/current
instants into the facility's `Africa/Monrovia` calendar date. Never use the
developer/browser timezone or blindly slice a timestamp containing an offset.
Historical Liberia offsets make a named timezone preferable to assuming UTC for
all timestamps. Estimated/incomplete DOB policy remains a product decision.

Evaluation date is required. Dashboard adapters supply today's facility date and
refresh at day rollover; entry adapters supply vaccination date and recalculate
on changes to DOB, date, vaccine/dose, configuration, or history, then again at
save. Backdating uses age/intervals at administration, not age today. Rejecting
future administration dates is a separate entry validation; dashboards may
legitimately evaluate future dates. No UI reactivity is part of this utility.

## History and duplicate semantics

The utility accepts normalized `{id, vaccineConceptUuid, sequenceNumber,
administeredDate}` records for **one patient**. The future adapter must fetch all
pages, verify successful/complete loading, retain completed/non-voided events,
resolve vaccine identities, and detect missing/ambiguous dose/date data. Never
treat a failed load, dose-less record, remote summary, or unsupported coding as
proof that a dose was not given. The utility rejects a missing history array;
it cannot itself prove completeness or patient scope.

Duplicate lookup considers the entire supplied history, including records dated
after a backdated evaluation date. Limiting duplicates to the evaluation date
would let a date change bypass duplicate prevention. `ADMINISTERED` means already
recorded, not necessarily administered as of the evaluation date. Prerequisite
eligibility uses only prerequisite doses administered on or before the evaluation
date. Multiple records for a prerequisite require reconciliation instead of
guessing which date to use. Editing excludes only the record's own ID; the
backend must independently authorize updates and preserve later-dose consistency
when an earlier date changes.

O3/FHIR structured history is the strongest existing basis, but selecting it as
the only product authority still requires approval. The national coded Obs form
does not automatically populate this model. No speculative legacy conversion,
dual-write mechanism, or reconciliation is included.

## Unresolved questions and limitations

The utility is date arithmetic, an explicit-policy evaluator, a normalized-history
contract, and synthetic-fixture tests. It configures no clinical schedule, answer
list, concept, or vaccine rule, and it does not change BCG or OPV0 behavior.

Before integration: resolve BCG upper age, OPV0 inclusive/exclusive boundary and
positive sequence mapping, catch-up and Rota maxima, non-OPV prerequisites and
intervals, due/overdue policy, DOB uncertainty, history authority/legacy handling,
cross-facility dose completeness, and backend concurrency design. The known
OPV1→OPV2 interval can later be configured as data. Catch-up policy, where a
programme allows doses only inside a finite window, is represented by that
window's upper age once the clinical limit is approved — not by a separate flag.
