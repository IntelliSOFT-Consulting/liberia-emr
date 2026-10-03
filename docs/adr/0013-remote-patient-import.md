# 0013: Remote patient import: a local read-only history and a shared patient record

**Status:** Accepted (2 October 2026)
**Ticket:** LE-383 (amends [ADR 0007](0007-pulled-record-scope.md) condition 1; records a
departure from [ADR 0005](0005-cross-facility-identity-reconciliation.md))
**Design:** [remote import sync isolation](../superpowers/specs/2026-10-02-remote-import-sync-isolation-design.md)

## Context

Remote patient search (LE-374, LE-375) lets a clinician find a patient registered at another
facility on the central server and bring them into their own facility. Two clinical cases
need it:

- **Visiting patient.** Seen here once or occasionally. The home facility still owns the
  history; this facility needs to see it and record today's care.
- **Referral in.** Ongoing care moves here. Past records still belong to the facility that
  wrote them; responsibility for *future* care moves.

Both are **add-only** at the importing facility: it records its own encounters, enrolments
and orders, and never changes records another facility created. Both need the history
**available offline**, because facilities lose connectivity to central for hours or days.

The first implementation copied the patient and their visits, encounters and observations
into the facility's OpenMRS tables. That runs into three things already decided:

1. **Sync pushes the copies back.** The facility's dbsync sender watches every table the
   import writes (`eip.watchedTables`). Facility B sends its copy of facility A's records to
   central under A's UUIDs. Central's receiver flags a row as a conflict only when the row was
   changed *outside* sync ([sync-eip.md](../architecture/sync-eip.md) §2.5.3). This row was
   changed *through* sync, so B's copy is applied without a word, and from then on A and B
   overwrite each other at central.
2. **ADR 0007 condition 1: "Query, never replicate."** The querying facility renders the
   remote record and never copies it into its local database. A copy in OpenMRS tables is
   exactly what that condition forbids, and copying observations goes beyond ADR 0007's
   enumerated scope (an encounter index *without* the observations within).
3. **ADR 0005: link, never merge.** Each facility's patient record is stored at central as
   that facility sent it, and the identity layer links records to a Central Person
   Identifier (CPI). An import that reuses central's patient UUID makes two facilities write
   to one patient record.

The offline requirement rules out the one design that satisfies ADR 0007 as written: a live
query with nothing stored locally shows nothing when central is unreachable.

### Options

- **A. Live query only (ADR 0007 as written).** Import a patient shell; render the history
  from central each time the chart opens. *Fails the offline requirement.*
- **B. Copy into OpenMRS tables and keep the copies out of sync.** Either filter imported
  UUIDs in a custom EIP sender route, or write them with `SET SESSION sql_log_bin=0` so
  Debezium never sees them. The history appears in the standard O3 widgets. *But* the sender
  filter is unverified against dbsync, `sql_log_bin` needs `SUPER` / `BINLOG ADMIN` and
  leaves gaps in point-in-time recovery, a later local edit to an imported row still syncs,
  and imported care is still counted in facility indicator reports and opened in AMPATH
  forms as if recorded here.
- **C. A separate read-only store that sync never watches.** Only a patient shell goes into
  OpenMRS tables. The history is a scoped FHIR bundle in facility tables of its own, shown
  read-only in a dedicated chart view. *Offline-capable; the store cannot leak by
  construction.* Costs: the history appears only in its own view, not the standard widgets,
  and the copy is a deliberate amendment to ADR 0007.
- **D. As C, but the shell is a new local patient** with its own UUID, linked to the source
  record by a synced attribute that central's identity service reads as link evidence.
  *Correct under ADR 0005*, but it produces linked records that need a master patient index
  to manage, and central does not run one.

## Decision

**Option C, with the patient shell reusing central's UUIDs (one shared record at central).**

### 1. The history is a scoped, read-only copy outside sync

- The history lives in `liberiaemr_remote_history` (one FHIR `Bundle` per patient and source
  facility, with `fetched_at`), never in OpenMRS clinical tables.
- `eip.watchedTables` is an allow-list of dbsync's own entity types, so these tables are
  invisible to sync. A CI check fails the build if one is ever added to it.
- Nothing can write to the store except the fetch service. No form, REST resource or chart
  action edits, voids or re-uses an item from it.
- The copy is refreshed from central when online and the cached copy is older than a
  configured age; offline, the cached copy is shown with its age.

This **amends ADR 0007 condition 1** from "query, never replicate" to: *query; a scoped copy
may be cached locally, but only in a store sync never watches, read-only, always shown with
its source facility and age.* Every other condition of ADR 0007 stands unchanged: the
enumerated scope, patient-scoped only, reason for access, every access audited, read-only and
attributed display, and middle-band identity candidates never returned as the patient's
record.

### 2. Central enforces the scope

The bundle comes from a patient-scoped endpoint at central that returns only the ADR 0007
list (as narrowed or widened by section 4 below) and applies any sensitive-category exclusion
the MOH names. A facility never receives what the policy excludes, so the filter is enforced
in one place and tested there (`qa/api/`).

### 3. One shared patient record at central

The importing facility creates `person`, `patient`, `person_name`, `person_address` and
`patient_identifier` rows **with central's UUIDs**, audit fields and preferred flags. They
reach central as upserts. While central still holds what the import copied, they are identical
rows and change nothing. If the patient's home facility edits those rows after the import and
its edit reaches central first, the shell's older rows arrive last and are applied, because
dbsync has no check that an update is newer than what central holds
([sync-eip.md](../architecture/sync-eip.md) §7.5, risk E17). That happens when the importing
facility goes offline before its sender pushes the shell. *(Corrected 3 October 2026: this
paragraph first said a stale-data check prevented it; dbsync 4.0.0 has none.)*
Records the importing facility creates afterwards sync normally against the same patient UUID.

This **departs from ADR 0005** for imported patients only: two facilities now write to one
patient record instead of each holding its own. Two rules keep the identity layer intact:

- `patient_link.facility_location_uuid` is set when the CPI is minted and never changed, so
  the patient stays attributed to the facility that registered them.
- An identifier added at the importing facility is **never marked preferred**, because the
  facility derivation reads the preferred identifier.

**Demographics edits are last-write-wins at central.** Two facilities editing the same
patient's name, address or attributes each send a full row; the last to arrive wins, with no
conflict raised. The import itself is a write of this kind: a shell that reaches central
after a newer edit from the home facility reverts it, with nothing edited at the importing
facility, and central keeps the reverted values until the home facility edits that patient
again. Accepted as a known limitation, with the import case accepted on 3 October 2026:
demographics edits are rare, clinical rows are unaffected (they are add-only and owned by
their author), and the alternatives need an MPI or a change to dbsync's receiver. When an MPI
exists, this decision should be revisited in favour of Option D.

### 4. Scope: observations and diagnoses stay out

The cached copy carries the ADR 0007 list and nothing more: active conditions, allergies and
intolerances, current medications, immunisations, MCH programme enrolments and current state,
the last ANC contact summary, and an encounter index (date, type, facility) **without
observations**.

Encounter diagnoses and observations were considered, because a copy invites more than a live
query did. They stay out: ADR 0007's reasoning (an enumerated list can be audited, a category
cannot) applies with more force to a copy than to a query, since a copy outlives the access
that produced it. Widening the scope later remains a new ADR and a fresh legal review.

## Agreed on acceptance

1. **The amendment to ADR 0007 condition 1**: a cached, read-only, scoped copy in place of
   "never replicate", for the offline requirement.
2. **Retention of the cached copy**: refreshed while the patient is under care at the
   importing facility, and purged after a configurable period without access. The period is
   a deployment setting of **at most 12 months**, and 12 months is also the default. A
   deployment may set it shorter, never longer. *(Value set on 3 October 2026; on acceptance
   this item left it open.)*
3. **Revocation purges the cache**: ADR 0007 relied on "nothing is replicated, so revoking
   access removes future visibility completely". With a cache, revoking a facility's access
   also purges its cached bundles. This is a required control.
4. **The shared-record departure from ADR 0005** and last-write-wins on demographics, until an
   MPI is in place. This includes an imported shell that reaches central after a newer edit
   and reverts it (accepted 3 October 2026, §3).

Accepting this ADR does not settle the two items still open from ADR 0007: sensitive-category
exclusions (for example HIV status) and the lawful basis, including whether consent is
captured at the point of import. They stay with ADR 0007, and the central endpoint applies
whatever the MOH decides there.

## Consequences

- Imported records cannot reach central through sync, so the silent overwrite in the Context
  cannot happen. `qa/sync/verify-remote-import.sh` (LE-388) holds every run to it: central's
  rows for the source facility are unchanged, the conflict queue is empty, and attribution
  does not move.
- The facility database now holds other facilities' clinical summaries. That adds one more
  copy of patient data at rest per importing facility to those listed in
  [sync-eip.md](../architecture/sync-eip.md) §7.4, so the cache inherits the facility's
  encryption-at-rest and backup controls. The fetch audit (user, patient, reason, outcome) is
  readable by the `ICT Auditor` role only.
- Revoking a facility's access is no longer complete on its own: cached bundles must be purged
  too. The purge is part of the revocation runbook, not an afterthought.
- Facility indicator reports never count another facility's care, because none of it is in
  the OpenMRS tables they read.
- Clinicians see imported history only in the dedicated "External records" view, never mixed
  into the standard Allergies, Conditions or Visits widgets. This keeps the source of every
  item visible, at the cost of one more place to look.
- Central holds one record for an imported patient, written by more than one facility. A
  demographics correction at one facility can be overwritten by an older edit from another
  arriving later, and by an imported shell synced after it. Nothing at central detects either.
  Accepted until an MPI exists.
- Superseding this ADR in favour of Option D (linked records) is the expected path once an
  MPI or national client registry is in place; the store and the scoped endpoint carry over
  unchanged.
