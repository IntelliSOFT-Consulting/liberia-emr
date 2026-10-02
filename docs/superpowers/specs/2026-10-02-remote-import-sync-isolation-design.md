# Remote patient import: sync isolation — design

**Date:** 2026-10-02
**Status:** draft, awaiting review
**Origin:** review of PR #215 (LE-374), finding 1: records imported through remote patient
search are written to tables the facility's dbsync sender watches, so the importing facility
pushes its copy of another facility's history back to central under the same UUIDs. Central's
receiver accepts it without a conflict, because the row was not changed outside sync, and from
then on the two facilities overwrite each other silently.

## Goal

A clinician at one facility can find a patient registered elsewhere, bring them into the
facility, see their history from other facilities **offline**, and record today's care,
without the importing facility ever pushing a row it did not create.

**Success looks like:** after an import and a sync cycle on the dev sync pair, central's rows
for the source facility's history are unchanged, the importing facility's new encounter has
arrived against the patient, `receiver_conflict_queue` is empty, and
`patient_link.facility_location_uuid` still names the source facility.

## Use cases

Both are **add-only** at the importing facility: it records its own encounters, enrolments and
orders, and never changes records another facility created.

| Case | Meaning | Needs |
|---|---|---|
| Visiting patient | Seen here once or occasionally; the home facility owns the history | History visible offline; today's visit recorded |
| Referral in | Ongoing care moves here; past records keep their author | Same, for longer |

## Decisions

| Decision | Choice | Rejected alternative |
|---|---|---|
| Where imported history lives | **A separate facility-side store** (`liberiaemr_remote_history*`), rendered by a read-only widget | Copying into OpenMRS tables and filtering sync (custom sender route); copying with `sql_log_bin=0`; live query only (fails the offline requirement) |
| How the importing facility identifies the patient | **One shared record: the shell reuses central's patient UUID** | A new local patient linked through a synced source attribute: correct under ADR 0005, but linked records need an MPI that central does not have |
| Demographics edits on a shared patient | **Allowed; last write wins at central**, documented as a known limitation | Read-only at the importer; add-only at the importer |
| Who enforces the scope | **Central's history endpoint** filters to the ADR-listed resources | Filtering at the facility after receipt |
| Clinical edits to imported records | **Impossible by construction**: the store is not an OpenMRS table, and no form or REST resource writes to it | Guards on OpenMRS rows |

## Architecture

### 1. Patient shell (OpenMRS tables, synced)

At import the facility creates `person`, `patient`, `person_name`, `person_address` and
`patient_identifier` from central's record:

- **Every row keeps central's UUID**, plus central's audit fields and preferred flags exactly.
  Preferred flags are never re-derived (`first || preferred` in #215 can produce two preferred
  names).
- Death data comes across with its cause and date, or not at all: OpenMRS 2.8's person
  validator rejects `dead=true` without a cause.
- Nothing else is written to the OpenMRS tables.

Because the shell's rows match central's, sync pushes them up as no-op upserts. Section 7.5 of
`sync-eip.md` (stale data never overwrites fresh) stops an older copy overwriting a newer one.
No suppression is needed.

Records the importing facility creates afterwards (visits, encounters, obs, orders,
enrolments, and any identifier it adds) are ordinary local rows and sync normally against the
shared patient UUID.

**Identifier rule:** an identifier added at the importing facility is never marked preferred.
`patient_link.facility_location_uuid` is set when the CPI is minted and never changed
afterwards, so a later identifier cannot move attribution. The ETL's facility derivation
does read the *preferred* identifier, though.

### 2. Remote history store (facility tables, never synced)

Created through `modules/liberiaemr/api/src/main/resources/liquibase.xml`:

- `liberiaemr_remote_history`: one row per (patient UUID, source facility location UUID).
  Columns: the FHIR `Bundle` as JSON, `fetched_at`, `source_facility_uuid`, and a content hash
  for change detection.
- `liberiaemr_remote_history_fetch`: an audit row per fetch. Columns: user, patient, reason
  for access, timestamp, outcome, resource count. This meets ADR 0007's conditions 3 and 4,
  and is readable by the `ICT Auditor` role only.

`eip.watchedTables` (`distribution/sync/application.properties.template`) is an allow-list
of dbsync's entity types, so these tables are invisible to sync without any exclusion setting.

### 3. Central history endpoint (central, new)

`GET /ws/rest/v1/liberiaemr/remotehistory/{patientUuid}`, scoped to one patient (no list or
bulk form):

- Returns a FHIR `Bundle` limited to the scope the new ADR settles. The ADR 0007 default is
  Condition, AllergyIntolerance, MedicationRequest, Immunization, programme enrolments and
  states, the last ANC contact summary, and an Encounter index without obs.
- Gathers the records of the patient and of every record linked to the same CPI. It excludes
  records at the requesting facility's own locations (the Health Facility subtree, ADR 0012),
  so they don't show twice.
- Applies any sensitive-category exclusion the MOH names.
- Returns an empty bundle, not a 404, when nothing is visible.
- Is protected by a new `View Remote History` privilege held by the facility's sync/service
  account.

### 4. Facility import and refresh service (facility, replaces most of #215's `importPatient`)

- Creates the shell, then fills the store, as two separate steps (see Data flow).
- Refreshes on chart open when the facility is online and the bundle is older than
  `liberiaemr.remoteHistory.maxAgeHours` (a global property, default 24).

### 5. "Records from other facilities" widget (ESM, facility)

- Read-only. It reads only from the store (`GET /ws/rest/v1/liberiaemr/remotehistory/local/{patientUuid}`).
- Every item shows its source facility. The widget shows "As of <fetched_at>".
- No edit, void, or "add to form" actions.

### Removed from #215

Copying visits, encounters, encounter providers and obs; the visit-type, encounter-type,
location and encounter-role fallbacks; and value coercion by the local datatype. Review
findings 3, 7, 8 and 9 go away with that code.

## Data flow

### Import (facility online; a user picks a central match)

1. **Reason for access** is captured before any fetch and logged in
   `liberiaemr_remote_history_fetch`.
2. **The shell is created in one transaction.** Any failure rolls the whole shell back, so a
   half-created patient never blocks a retry.
3. **The history bundle is fetched** from the central endpoint and written to the store, one
   row per source facility. This is a separate step: if it fails, the shell stays, the widget
   shows "History not yet retrieved", and retry and the next chart open both try again.
4. **Privileges:** the import requires `Add Patients` and a new `Import Remote Patient`
   privilege. The store is written with elevated privileges inside the service, so a role
   without visit, encounter or obs privileges (Records Officer) can import.

### Re-import or retry

An existing shell is not an early return. Rows that already exist are skipped, and the history
is refreshed. The operation can be repeated safely.

### Chart open

| State | Behaviour |
|---|---|
| Online, bundle older than max age | Background refresh; fetch logged with the reason "routine refresh" |
| Online, bundle fresh | Show cached bundle |
| Offline, bundle present | Show cached bundle with "As of <time>" |
| Offline, no bundle | "History from other facilities unavailable offline" |

### Search

Central matches that already exist locally (same patient UUID) stay hidden, as in #215. The
`alreadyLocalCount` field stays.

## Accepted limitations

- **Two facilities editing demographics:** each sends a full row, and the last to arrive wins
  at central, with no conflict raised. Clinical records are unaffected, because they are
  add-only and owned by the facility that created them.
- **A shared patient record departs from ADR 0005**, under which each facility's record is
  stored as received. It is temporary, until an MPI can hold linked records.
- **A cached bundle can be stale offline.** The widget always shows its age.
- **Imported history isn't in the standard O3 widgets** (visits, vitals, results). It shows
  only in the dedicated widget.

## Governance

A new ADR, **0013 "Remote patient import: local read-only history and a shared patient
record"**, is required before steps 3–5 of Delivery ship to a facility. It:

- amends ADR 0007 condition 1 ("query, never replicate") to allow a scoped copy, only in a
  store sync doesn't watch, and read-only;
- records the shared-record departure from ADR 0005 and the last-write-wins rule;
- settles whether obs are in scope, which ADR 0007 leaves out.

It goes to MOH ICT and legal, as ADR 0007 requires for any widening of scope.

## Testing

- **Sync isolation, `qa/sync/verify-remote-import.sh` on the dev sync pair:** import a patient
  from facility A at facility B, record an encounter at B, and run sync. Then assert:
  - central's rows for A's history are unchanged (row hashes before and after);
  - B's encounter is present against the shared patient UUID;
  - `receiver_conflict_queue` is empty;
  - `patient_link.facility_location_uuid` is unchanged.
- **Scope boundary, `qa/api/`:** the central endpoint returns only the ADR-listed resource
  types and nothing else.
- **Watched-tables guard:** CI fails if any `liberiaemr_remote_history*` table appears in
  `eip.watchedTables`.
- **Facility unit and integration tests:**
  - the shell transaction rolls back on failure;
  - repeating the import doesn't duplicate rows;
  - a deceased patient imports;
  - preferred flags are preserved;
  - an identifier added at the importer is not preferred;
  - a Records Officer can import;
  - the offline path renders the cached bundle;
  - a failed fetch leaves the shell and is retried.

## Delivery

1. **ADR 0013**, raised for MOH ICT and legal review.
2. **#215 reworked to the shell**: the transactional shell, the retry-safe import, the
   privilege fix, death data and preferred flags. It is mergeable before ADR 0013 is
   accepted, because it writes only demographics to synced tables.
3. **Central history endpoint**, with the scope filter and the `qa/api/` test.
4. **Facility store, import and refresh service.**
5. **ESM widget.**
6. **`qa/sync/verify-remote-import.sh`.**

## Jira and PR follow-up (after this spec is approved)

- **LE-382** is rewritten: fill the store and widget with every entity in the ADR scope. Its
  entity list stays as the checklist, and the "central UUIDs on child rows" prerequisite
  applies to the shell only.
- **New tickets** linked to LE-374: the ADR, the central endpoint, the facility store and
  refresh, the widget, and the isolation test.
- **PR #215** gets one summary comment explaining the narrowed scope. Inline findings 2, 4, 5,
  6 and 10 carry over to the shell; 3, 7, 8 and 9 go away with the copying code; 1 is resolved
  by this design.
