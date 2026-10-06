# Entity coverage and sync order

**Date:** 18 August 2026 · **Ticket:** LE-22
**Verified against:** `openmrs-dbsync` `TableToSyncEnum` (master), release 4.0.0
**Last reviewed against the build:** 6 October 2026 (`medication_dispense`, LE-358)

What actually synchronises facility → central, in what order, what is covered out of the box,
and what needs custom work. Companion to [Sync & EIP architecture](sync-eip.md) and the
[module evaluation](sync-module-evaluation.md).

The dbsync README says only *"patient records and their clinical data"* and gives no list.
The list below comes from `TableToSyncEnum` in source, which is authoritative.

---

## 1. The 34 supported entities

| # | Entity | Group | Our route |
| --- | --- | --- | --- |
| 1 | `PERSON` | Person | `patient-push` |
| 2 | `PATIENT` | Person | `patient-push` |
| 3 | `PERSON_NAME` | Person | `patient-push` |
| 4 | `PERSON_ADDRESS` | Person | `patient-push` |
| 5 | `PERSON_ATTRIBUTE` | Person | `patient-push` |
| 6 | `PATIENT_IDENTIFIER` | Person | `patient-push` |
| 7 | `RELATIONSHIP` | Person | `patient-push` |
| 8 | `VISIT` | Visit | `visit-push` |
| 9 | `VISIT_ATTRIBUTE` | Visit | `visit-push` |
| 10 | `ENCOUNTER` | Encounter | `encounter-push` |
| 11 | `ENCOUNTER_PROVIDER` | Encounter | `encounter-push` |
| 12 | `ENCOUNTER_DIAGNOSIS` | Encounter | `encounter-push` |
| 13 | `OBS` | Encounter | `encounter-push` |
| 14 | `CONDITIONS` | Clinical | `encounter-push` |
| 15 | `ALLERGY` | Clinical | `encounter-push` |
| 16 | `DIAGNOSIS_ATTRIBUTE` | Clinical | `encounter-push` |
| 17 | `PATIENT_PROGRAM` | Programme | `program-push` |
| 18 | `PATIENT_STATE` | Programme | `program-push` |
| 19 | `PATIENT_PROGRAM_ATTRIBUTE` | Programme | `program-push` |
| 20 | `ORDERS` | Orders | `order-push` |
| 21 | `DRUG_ORDER` | Orders | `order-push` |
| 22 | `TEST_ORDER` | Orders | `order-push` |
| 23 | `REFERRAL_ORDER` | Orders | `order-push`, unverified (§4) |
| 24 | `ORDER_GROUP` | Orders | `order-push` |
| 25 | `ORDER_ATTRIBUTE` | Orders | `order-push` |
| 26 | `ORDER_GROUP_ATTRIBUTE` | Orders | `order-push` |
| 27 | `CONCEPT` | Metadata | reference |
| 28 | `CONCEPT_ATTRIBUTE` | Metadata | reference |
| 29 | `LOCATION` | Metadata | reference |
| 30 | `LOCATION_ATTRIBUTE` | Metadata | reference |
| 31 | `PROVIDER` | Facility data | synced, referenced by encounters |
| 32 | `PROVIDER_ATTRIBUTE` | Metadata | not watched by dbsync |
| 33 | `USERS` | Facility data | synced as references, see §4 |
| 34 | `DATAFILTER_ENTITY_BASIS_MAP` | Access control | not used in v1 |

**Every one of our five planned routes is covered by existing entity support.** This is the
most important finding in this document: the route inventory in
`integration/eip/routes/README.md` does not require custom entity development. It requires
configuration and verification.

### 1.1 The enabled set

The sender watches exactly the tables named by `eip.watchedTables` in
`distribution/sync/application.properties.template`, openmrs-eip's own property for the
Debezium table list. dbsync bundles a default of 29 (everything above except 27 to 30 and 32,
which it never watches); we declare 28, leaving out `DATAFILTER_ENTITY_BASIS_MAP`. Declaring
the set in our template rather than inheriting it from the jar keeps it reviewed, the same at
every facility, and asserted in CI. `qa/sync/verify-e2e-push.sh` checks the running sender
watches that set and pushes one record from every route group to central.

---

## 2. Sync order

### 2.1 The enum order is *not* the sync order

`TableToSyncEnum` declares entities in an order that is **not** dependency-safe: `PERSON_NAME`
is 17th, after `OBS`; `PATIENT_IDENTIFIER` is 20th. Do not read the declaration order as a
loading order, and do not rely on it.

Ordering in a change-data-capture system comes from **the binlog**: events are emitted in the
order the database committed them. Because OpenMRS itself cannot create an encounter before
its patient, the natural binlog order is already dependency-correct at source.

### 2.2 What we require

**Per-patient FIFO.** All changes for one patient are applied at central in the order the
facility committed them. Global ordering across patients is neither required nor desirable;
buying it would serialise the whole national push behind the slowest record.

The dependency chain that must hold:

```
  person ─▶ patient ─▶ patient_identifier
     │                      │
     │                      ▼
     └────────────────▶ visit ─▶ encounter ─▶ obs
                          │         │
                          │         ├─▶ encounter_provider
                          │         └─▶ encounter_diagnosis
                          │
                          ├─▶ patient_program ─▶ patient_state
                          └─▶ orders ─▶ {drug,test,referral}_order

  Referenced metadata (concept, location) must EXIST at central first, and is
  delivered by the content-package image, not by sync. Providers and users sync. See §3:
  a missing reference does not park, it becomes a placeholder.
```

### 2.3 Out-of-order arrival

Out-of-order arrival still happens in practice: retries, partial drains, a message parked
behind a conflict. The receiver must **park** an event whose dependency is absent and retry it
when the dependency lands, rather than rejecting it or stalling the stream behind it.

dbsync ships retry queues (`ReceiverRetryQueueItem`) and a conflict queue
(`ConflictQueueItem`) that cover this shape. **The exact parking and retry semantics are not
yet confirmed** (the spike settled streaming and snapshots, not parking; §6), and no alert
exists yet for a message parked longer than a configured age, because a long-parked dependency means something upstream was lost and
it is the earliest visible symptom.

### 2.4 Deletes, voids and merges

Debezium emits create, update and delete events (`c`/`u`/`d`), so hard deletes are captured,
and voiding is an ordinary update whose `voided`/`date_voided` columns participate in the
receiver's conflict logic. Two cases are still unverified:

- **A facility-side patient merge** is a burst of updates and voids that syncs like any other
  change; the identity layer at central must then collapse the losing record's link into an
  alias of the surviving record's CPI (ADR 0005).
- **Hard deletes of rows central has already applied**: confirm the receiver processes the
  `d` event rather than parking it, and that the hash tables are updated so reconciliation
  does not report the deleted row as divergence forever.

---

## 3. Metadata is *not* synchronised: and must not be

Entities 27 to 30 and 32 are metadata. They are supported by dbsync, but in our architecture
they are **delivered by the content-package build, not by sync.** Providers (31) are data:
each facility creates its own, and they reach central by sync.

Facility and central images are built from the same national content packages, so shared
metadata holds identical UUIDs, every UUID declared once in `variables.properties` and
referenced as `${var.*}` (ADR 0003). Central is its own build (the `-central` images,
[ADR 0011](../adr/0011-central-composition.md)) and loads the locations of every site package,
so it holds every location a facility can reference
([ADR 0012](../adr/0012-central-site-locations.md)). This satisfies dbsync's stated assumption that "metadata
is already centrally managed", by a stronger mechanism than metadata sharing: it is baked
into an immutable image rather than applied by an operator.

**The rule this creates:** facility and central must never run different content-package
versions across an upgrade boundary. Central's backend carries every site package's locations
for the same reason (ADR 0012). This belongs in the deploy runbook and in the upgrade rehearsal
in `qa/upgrade/`.

**What breaking it does (observed for locations on 30 September 2026, LE-339):** the receiver
does not fail or park the record. It inserts a placeholder row with the missing UUID (for a
location: name `[Default]`, retired, retire reason `[placeholder]`, no parent, no tags) and
applies the record against it. The retry and conflict queues stay empty, so the record is
silently misattributed. Each type was tested on dbsync 4.0.0 (LE-373, 1 October 2026):

| Missing at central | What the receiver does |
| --- | --- |
| location, concept, encounter type, visit type, encounter role, relationship type | Placeholder row: retired, retire reason `[placeholder]`, no name; the record applies |
| programme | Placeholder named `[Default] - <uuid>`, retired (the table has no retire reason); the enrolment applies |
| patient identifier type, person attribute type | No placeholder; the record parks in the retry queue (`ReceiverErrors`) and applies once the metadata is loaded |

A placeholder concept's datatype and class are dbsync's shared `PLACEHOLDER_CONCEPT_DATATYPE_LIGHT`
and `PLACEHOLDER_CONCEPT_CLASS_LIGHT` rows, present on every install. The reconciliation check at
central counts placeholders on every pass (`sync_placeholder_metadata`) and
`SyncPlaceholderMetadata` alerts on any. Repairing one in place is runbook
`sync-operations.md` section 17. `qa/sync/verify-second-facility.sh` checks every facility
location, and its `--negative-control` reproduces a placeholder.

The first one found in practice was on the dev pair: two partograph concepts given new uuids in
content after both dev databases had loaded the old ones (LE-373).

---

## 4. Entities needing a decision

| Entity | Issue | Recommendation |
| --- | --- | --- |
| `DRUG_ORDER`, `TEST_ORDER`, `REFERRAL_ORDER` | dbsync README states **sync of Order subclasses fails** (EIP-142). Models exist (`DrugOrderModel`, `TestOrderModel`, `ReferralOrderModel`) | **Disproven on 4.0.0 for `DrugOrder` and `TestOrder`**: both arrive at central as their subclass rows, checked by `qa/sync/verify-e2e-push.sh` on every run. `ReferralOrder` stays unverified: the REST module on platform 2.8 cannot create one, and no form issues one. `order-push` stays enabled |
| `USERS` | Supported; the concern was credential material | **Confirmed safe**: `UserModel` carries uuid, username, system id, person uuid and audit fields only, no password, salt or secret question. Kept, because every synced row references its creator by user uuid; the receiver skips the daemon user itself |
| `DATAFILTER_ENTITY_BASIS_MAP` | Belongs to the `datafilter` module, which we do not run; the table does not exist on a facility database | **Left out** of `eip.watchedTables`. Relevant only if central ever becomes a point-of-care system (it must not; see [architecture](sync-eip.md) §1.8c) |
| `MEDICATION_DISPENSE` | Not one of the 34. Central has no dispensing data, so a dispense-time indicator cannot be computed there | **Not synced; decided 6 October 2026 (LE-358).** dbsync 4.0.0 has no entity for it, and adding it to `eip.watchedTables` breaks every dispense event rather than syncing it. Central uses the drug order's time. Review in §4.1 |
| Complex obs (attachments) | `ComplexObsProcessor` / `ComplexObsHash` exist, so binary obs are handled | Confirm whether any MCH/OPD form captures complex obs. If so, size the queue and bandwidth for it: attachments dominate transfer volume on a poor link |

### 4.1 `medication_dispense` (LE-358)

Reviewed against core 2.8.8 (`liquibase-schema-only-2.7.x.xml` in `openmrs-api-2.8.8.jar`; the
table dates from 2.6, TRUNK-6071), dbsync 4.0.0 and openmrs-eip 4.2.0 sources, and Debezium
2.4.0.Final (the `debezium-version` of Camel 4.1.0, which eip 4.2.0 pins).

**Who writes it here.** `@openmrs/esm-dispensing-app` 1.11.1 (`distro.properties`), over FHIR
`MedicationDispense` in fhir2 4.2.0; there is no O2 dispensing module. The app's menu entry
needs *Get Medication Dispense*, which only the Pharmacist role holds (`roles-common.csv`,
`config-national.json`). Every site package has a pharmacy location. Whether pharmacists at the
pilot facilities record dispenses in it, and so whether the table holds anything, is not known
from the repository: `qa/` writes no dispense.

**dbsync cannot sync it.** `TableToSyncEnum` (`api/.../service/TableToSyncEnum.java:107-177`)
has no `MEDICATION_DISPENSE`, and there is no entity, model, mapper or hash table for it.
Nothing checks the watched list against the enum at start-up: eip passes the names straight to
Debezium's `table.include.list` (`openmrs-watcher/.../config/WatcherConfig.java:80-94`). Each
event then fails when the sender looks the table up: `openmrs:extract?tableToSync=…`
(`sender-app/.../camel/sender-db-sync-route.xml:28`) binds to a `TableToSyncEnum` parameter
(`api/.../camel/OpenmrsEndpoint.java:26-27`), and deletes call
`TableToSyncEnum.getTableToSyncEnum`, which is `valueOf` (`sender-db-sync-route.xml:16`,
`TableToSyncEnum.java:204-206`). The failed event goes to `sender_retry_queue` and is retried
every 30 minutes (`db-event.retry.interval`) without end. Syncing it would mean writing the
entity, model, mapper, hash entity and their management-database tables, carried as a second
patch in `distribution/sync/patches/` on every dbsync upgrade.

**Adding a table does not send its existing rows.** With a saved offset, Debezium's MySQL
connector snapshots neither schema nor data: `MySqlSnapshotChangeEventSource.getSnapshottingTask`
returns early when "a previous offset indicating a completed snapshot has been found"
(`MySqlSnapshotChangeEventSource.java:98-103`). `snapshot.new.tables` is still declared
(`MySqlConnectorConfig.java:795`) and parsed (`:979-980`), but nothing in the 2.4.0 connector
reads it. `debezium.snapshotMode` (`SYNC_SNAPSHOT_MODE`) applies only to a sender with no saved
offset. A facility already syncing would therefore send only dispenses made after the change.
Its earlier ones would need a resend of the whole database ([sync-operations.md](../runbooks/sync-operations.md)
section 11), or an incremental snapshot through a Debezium signal table, which eip does not set up.

**If it were synced**, the rest would be in order:

| Column | References | At central |
| --- | --- | --- |
| `patient_id`, `encounter_id` | `patient`, `encounter` | synced |
| `drug_order_id` | `drug_order` | synced (`DRUG_ORDER`) |
| `dispenser` | `provider` | synced (`PROVIDER`) |
| `creator`, `changed_by`, `voided_by` | `users` | synced (`USERS`) |
| `concept`, `status`, `status_reason`, `type`, `quantity_units`, `dose_units`, `route`, `substitution_type`, `substitution_reason` | `concept` | content-package image (§3) |
| `drug_id` | `drug` | content-package image (`drugs/`); dbsync's `DrugLight` already serves `drug_order` |
| `frequency` | `order_frequency` | content-package image (`orderfrequencies/`); `OrderFrequencyLight` likewise |
| `location_id` | `location` | image, every site's locations (ADR 0012) |

- **Ordering.** A dispense is committed after the order it fills, so binlog order already
  delivers `drug_order` first; it would ride the same per-patient FIFO as orders (§2.2).
- **Volume.** At most one row per dispensed order line, so no more than `drug_order`, and far
  below `obs`.
- **PHI.** The same class as `drug_order`, which already syncs: the patient, the drug, the dose,
  free-text `dosing_instructions`. It would add no new category, and the payload is encrypted
  like every other.
- **Updates.** A dispense changes status (preparation, in progress, completed, declined, on
  hold, cancelled) and the app can edit or delete it. These are ordinary updates, voids or
  deletes, under the receiver's conflict rules like any other row (§2.4).

**Decision: (b), accept the order time at central.** Only MAL-001's 24-hour window uses the
dispense time. MAL-001 is not built yet, and the formulary has no ACT for it to count. The
indicators that are built use the order, so central and the facility agree on them.
[reporting-etl.md](../runbooks/reporting-etl.md) section 7 sets out the difference.
Reopen this if the MOH needs dispense time nationally, or if a dbsync release adds the entity.
Either way, plan the resend for facilities already syncing.

---

## 5. What must be built (not covered by any entity)

| Item | Why it is not an entity | Where | Status |
| --- | --- | --- | --- |
| **Central Person Identifier (CPI) and link table** | Identity is central-side state, not facility data | [ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md), [architecture](sync-eip.md) §2 | Built, through the National ID rule (§2.5 As built) |
| **Duplicate review queue** | A workflow, not a record | ADR 0005 | Doubtful matches are stored in `match_review`; no page and no MOH owner yet |
| **Cross-facility query** | A FHIR read path, Sprint 4 | [ADR 0007](../adr/0007-pulled-record-scope.md), [architecture](sync-eip.md) §6 | Not built; ADR 0007 is still Proposed |
| **Reconciliation parity report** | Hash tables exist; the periodic facility-vs-central report did not | [architecture](sync-eip.md) §5.5 | Built for existence (`SyncRecordsMissing`); content comparison not built |
| **Heartbeat / silence alerting** | Detecting a facility that has stopped syncing | [architecture](sync-eip.md) F7 | `SyncFacilitySilent` built; no heartbeat, so "nothing recorded" and "no contact" look the same |

---

## 6. Verification checklist

Each of these is a test, not an assertion:

- [x] All 34 entities enumerated against our enabled route set; disabled ones explicitly listed (§1.1, `eip.watchedTables`, asserted in CI)
- [ ] Per-patient ordering proven under retry and partial drain
- [ ] Out-of-order dependency parking observed and recovering
- [x] `Order` subclass defect reproduced or disproven on 4.0.0 (disproven for `DrugOrder` and `TestOrder`, `qa/sync/verify-e2e-push.sh`; `ReferralOrder` not creatable, §4)
- [x] `UserModel` payload inspected and confirmed to carry no credential material (§4)
- [ ] Metadata UUID parity asserted between facility and central images (the e2e check relies on it for the visit type, encounter type, concepts and programme it uses; `qa/sync/verify-second-facility.sh` covers every facility location; nothing covers the rest of the set, and a gap shows up as a placeholder, not a failure, §3)
- [x] `medication_dispense` reviewed: not synced, central uses the order time (§4.1, LE-358)
- [ ] Complex obs behaviour confirmed, and sized if in use
