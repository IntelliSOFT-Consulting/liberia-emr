# Entity coverage and sync order

**Date:** 18 August 2026 · **Ticket:** LE-22
**Verified against:** `openmrs-dbsync` `TableToSyncEnum` (master), release 4.0.0

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
| 21 | `DRUG_ORDER` | Orders | `order-push` ⚠ |
| 22 | `TEST_ORDER` | Orders | `order-push` ⚠ |
| 23 | `REFERRAL_ORDER` | Orders | `order-push` ⚠ |
| 24 | `ORDER_GROUP` | Orders | `order-push` |
| 25 | `ORDER_ATTRIBUTE` | Orders | `order-push` |
| 26 | `ORDER_GROUP_ATTRIBUTE` | Orders | `order-push` |
| 27 | `CONCEPT` | Metadata | reference |
| 28 | `CONCEPT_ATTRIBUTE` | Metadata | reference |
| 29 | `LOCATION` | Metadata | reference |
| 30 | `LOCATION_ATTRIBUTE` | Metadata | reference |
| 31 | `PROVIDER` | Metadata | reference |
| 32 | `PROVIDER_ATTRIBUTE` | Metadata | reference |
| 33 | `USERS` | Metadata | reference ⚠ see §4 |
| 34 | `DATAFILTER_ENTITY_BASIS_MAP` | Access control | not used in v1 |

**Every one of our five planned routes is covered by existing entity support.** This is the
most important finding in this document: the route inventory in
`integration/eip/routes/README.md` does not require custom entity development. It requires
configuration and verification.

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

  Referenced metadata (concept, location, provider) must EXIST at central first,
  but is delivered by the content-package image, not by sync. See §3.
```

### 2.3 Out-of-order arrival

Out-of-order arrival still happens in practice: retries, partial drains, a message parked
behind a conflict. The receiver must **park** an event whose dependency is absent and retry it
when the dependency lands, rather than rejecting it or stalling the stream behind it.

dbsync ships retry queues (`ReceiverRetryQueueItem`) and a conflict queue
(`ConflictQueueItem`) that cover this shape. **Confirm the exact parking and retry semantics
during the Step 0/3 spike** rather than assuming, and alert on any message parked longer
than a configured age, because a long-parked dependency means something upstream was lost and
it is the earliest visible symptom.

### 2.4 Deletes, voids and merges

Debezium emits create, update and delete events (`c`/`u`/`d`), so hard deletes are captured,
and voiding is an ordinary update whose `voided`/`date_voided` columns participate in the
receiver's conflict logic. Two cases still need explicit verification in the spike:

- **A facility-side patient merge** is a burst of updates and voids that syncs like any other
  change; the identity layer at central must then collapse the losing record's link into an
  alias of the surviving record's CPI (ADR 0005).
- **Hard deletes of rows central has already applied**: confirm the receiver processes the
  `d` event rather than parking it, and that the hash tables are updated so reconciliation
  does not report the deleted row as divergence forever.

---

## 3. Metadata is *not* synchronised: and must not be

Entities 27–32 are metadata. They are supported by dbsync, but in our architecture they are
**delivered by the content-package build, not by sync.**

Facility and central run the same `liberia-emr-backend` image, so they hold identical
metadata with identical UUIDs, every UUID declared once in `variables.properties` and
referenced as `${var.*}` (ADR 0003). This satisfies dbsync's stated assumption that "metadata
is already centrally managed", by a stronger mechanism than metadata sharing: it is baked
into an immutable image rather than applied by an operator.

**The rule this creates:** facility and central must never run different content-package
versions across an upgrade boundary. A concept or location UUID that exists at a facility but
not at central is a sync failure at the receiver. This belongs in the deploy runbook and in
the upgrade rehearsal in `qa/upgrade/`.

---

## 4. Entities needing a decision

| Entity | Issue | Recommendation |
| --- | --- | --- |
| `DRUG_ORDER`, `TEST_ORDER`, `REFERRAL_ORDER` | dbsync README states **sync of Order subclasses fails**. Models exist (`DrugOrderModel`, `TestOrderModel`, `ReferralOrderModel`): this is a **known defect, not missing support** | Verify against 4.0.0 during the spike. If it stands: **defer `order-push` out of the first release** and fix upstream. Do not build lab/pharmacy reporting on a known-defective path |
| `USERS` | Supported, but user rows carry credential material | **Sync user references only**: never password hashes or secret answers. A central copy of every facility's credentials is a breach waiting for its incident report. Confirm what the `UserModel` carries before enabling |
| `DATAFILTER_ENTITY_BASIS_MAP` | Belongs to the `datafilter` module, which we do not run | Leave disabled in v1. Relevant only if central ever becomes a point-of-care system (it must not; see [architecture](sync-eip.md) §1.8c) |
| Complex obs (attachments) | `ComplexObsProcessor` / `ComplexObsHash` exist, so binary obs are handled | Confirm whether any MCH/OPD form captures complex obs. If so, size the queue and bandwidth for it: attachments dominate transfer volume on a poor link |

---

## 5. What must be built (not covered by any entity)

| Item | Why it is not an entity | Where |
| --- | --- | --- |
| **Central Person Identifier (CPI) and link table** | Identity is central-side state, not facility data | [ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md), [architecture](sync-eip.md) §2 |
| **Duplicate review queue** | A workflow, not a record | ADR 0005 |
| **Cross-facility query** | A FHIR read path, Sprint 4 | [ADR 0007](../adr/0007-pulled-record-scope.md), [architecture](sync-eip.md) §6 |
| **Reconciliation parity report** | Hash tables exist; the periodic facility-vs-central report does not | [architecture](sync-eip.md) §5.5 |
| **Heartbeat / silence alerting** | Detecting a facility that has stopped syncing | [architecture](sync-eip.md) F7 |

---

## 6. Verification checklist

Before Sprint 3 closes, each of these is a test, not an assertion:

- [ ] All 34 entities enumerated against our enabled route set; disabled ones explicitly listed
- [ ] Per-patient ordering proven under retry and partial drain
- [ ] Out-of-order dependency parking observed and recovering
- [ ] `Order` subclass defect reproduced or disproven on 4.0.0
- [ ] `UserModel` payload inspected and confirmed to carry no credential material
- [ ] Metadata UUID parity asserted between facility and central images
- [ ] Complex obs behaviour confirmed, and sized if in use
