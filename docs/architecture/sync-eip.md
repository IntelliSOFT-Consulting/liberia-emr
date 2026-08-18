# Sync & EIP architecture

**Status:** Draft for review by Paul (IntelliSOFT) and the MOH ICT Unit.
**Target sign-off:** 21 August 2026 (LE-22).
**Implements:** Sprint 3 (outbound push), Sprint 4 (cross-facility query).

This is the design the sync layer is built from. It exists because the sync layer is the
highest engineering risk in the programme (IMPLEMENTATION.md §3) and because three of its
decisions are clinical-safety and legal decisions rather than technical ones, so they need a
named MOH owner, not a default.

The three decisions requiring MOH ICT agreement are marked **DECISION 1/2/3** and each
carries a recommendation (§2, §3, §4), collected as questions in §8.

They are not the only open items. §1.1 sets out what the sync module we depend on actually
provides and what its supported-configuration envelope is, and the distribution currently
sits outside that envelope on both the database and the platform version. Those are
engineering risks we own rather than MOH decisions; they are collected in §9 and they are
the ones most likely to move the Sprint 3 date.

Related: [`integration/eip/routes/README.md`](../../integration/eip/routes/README.md) (route
contract), [`integration/cross-facility/README.md`](../../integration/cross-facility/README.md),
[ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md) (identity),
[ADR 0007](../adr/0007-pulled-record-scope.md) (pulled-record scope).

---

## 1. Push topology

### 1.1 What we are building on: and what it constrains

**This section governs the rest of the document.** The sync layer is not built from scratch;
it is built on `openmrs-eip` and the DB-sync routes on top of it. That module makes most of
the decisions below for us, and it comes with a supported-configuration envelope that the
distribution currently sits outside of. Designing as though those were open choices is how
a design document produces a plan that cannot be implemented.

**The two artefacts are not the same thing:**

- [`openmrs/openmrs-eip`](https://github.com/openmrs/openmrs-eip) is a *toolbox*: the
  `openmrs-watcher` (the Debezium engine reading the source database binlog), the OpenMRS
  Camel component, and a Spring Boot launcher. It is not a deployable facility→central
  sync application.
- [`mekomsolutions/openmrs-dbsync`](https://github.com/mekomsolutions/openmrs-dbsync) is
  "a set of openmrs-eip routes to sync OpenMRS clinical data over a network of instances":
  the actual **sender** and **receiver** Spring Boot applications. This is what the `sync`
  and `sync-receiver` services in our compose files have to be.

The note in `distribution/distro.properties` (that `openmrs-eip` is a standalone Camel
application rather than an OMOD) is correct but incomplete: it names the toolbox, not the
deployable. Neither is version-pinned anywhere in the distribution today.

**Versions to pin** (neither is pinned today; see [ADR 0008](../adr/0008-adopt-openmrs-dbsync.md)):
`openmrs-dbsync` **4.0.0**, `openmrs-eip` **4.2.0**, Camel 4.1.0, Java 17. Master is
`4.1.0-SNAPSHOT`; no SNAPSHOT ships. The 3.x line is Java 8 and therefore not a candidate.

**What DB-sync already provides**, verified in source rather than inferred. None of this should
be reimplemented:

| Concern | Provided |
| --- | --- |
| Change capture | Debezium engine over the source binlog (`openmrs-watcher`) |
| Entity coverage | **34 OpenMRS entities** (`TableToSyncEnum`): [full list](sync-entity-coverage.md) |
| Wire format | Its own serialisation: entity loaded by UUID and serialised |
| Transport | JMS, with **ActiveMQ Artemis the recommended and documented broker** |
| Retry | Management-database queues: `sender_retry_queue`, `ReceiverRetryQueueItem` |
| **Conflict detection** | `receiver_conflict_queue`: diverts when central's row is newer than the payload |
| **Change detection** | Per-entity hash tables (`*Hash`, `HashBatchUpdater`) |
| **Payload encryption** | PGP-style, independent of TLS (`SenderEncryptionProperties`) |
| **Metrics** | Prometheus endpoint (`ReceiverPrometheusConfig`) |
| Search index at central | `SearchIndexUpdateTask`, `FullIndexerTask` |
| Queue hygiene | `CleanerTask`, synced-message archiving |
| Multi-facility | `SiteInfo` in receiver management |
| Directionality | One receiver, one or more senders, **one-way only** |

This is a mature product, and the design below treats it as one: our job is to configure,
verify and fill gaps, not to rebuild. See the [module evaluation](sync-module-evaluation.md)
for the options considered and why this one was chosen.

**What its documented envelope says**, against what we currently pin:

| | DB-sync supports | LiberiaEMR pins | |
| --- | --- | --- | --- |
| OpenMRS platform | 2.5 or 2.6 | **2.8.8** (ADR 0006) | ⚠ outside |
| Database | MySQL 5.7.x, 8.0.x | **MariaDB 10.11** (both compose files) | ⚠ outside |
| Java | JDK 17 | 17 | ✅ |
| Directionality | One-way | One-way | ✅ |

Three stated limitations that bear directly on our scope:

- **"Only Patient and clinical data is synced."**
- **Order subclasses (`TestOrder`, `DrugOrder`, `ReferralOrder`) have known sync issues**,
  and `order-push` is in our route inventory.
- **The receiver is not intended to be a point-of-care system**, because of
  conflict-overwrite risk.

These are addressed in §1.8. They are the most important open items in this document, and
they are engineering-schedule risks rather than MOH decisions, which means they are ours,
not the MOH's, and they will not be resolved by the 21 August sign-off meeting.

### 1.2 Shape

Each facility runs a complete EMR and pushes to central. Central never writes into a
facility database in this release. There is exactly one write direction.

```
  FACILITY (Careysburg / Barnersville)                       CENTRAL (MOH)
  ┌───────────────────────────────────────┐                  ┌────────────────────────────┐
  │  backend (OpenMRS)                    │                  │  broker (Artemis) ◀── NEW  │
  │      │ writes                         │                  │      │                     │
  │      ▼                                │      mTLS        │      ▼                     │
  │  db ──binlog──▶ sync (dbsync sender)  │═════════════════▶│  sync-receiver             │
  │                   │                   │  JMS over TLS    │      │ upsert by UUID      │
  │                   ├──▶ sync-mgt db ◀── NEW               │      ▼                     │
  │                   │    (retry queues) │  facility →      │  backend (OpenMRS)         │
  │                   ▼                   │  central only    │      │                     │
  │              sync-queue (durable vol) │                  │      ▼                     │
  └───────────────────────────────────────┘                  │  db                        │
                                                             │      ├──▶ identity/link    │
  Offline: writes keep landing in db and                     │      ├──▶ DHIS2 export     │
  accumulating locally. Care never stops.                    │      └──▶ cross-facility   │
                                                             │           query (Sprint 4) │
                                                             └────────────────────────────┘
```

Two services marked **NEW** above do not exist in the compose files yet and are not
optional: DB-sync's transport is JMS (§1.4), and its sender keeps its retry state in a
**management database** separate from the OpenMRS database (§1.5). The `sync` service
currently receives only OpenMRS database credentials.

Services already declared: `sync` in
[`distribution/compose/facility/docker-compose.yml`](../../distribution/compose/facility/docker-compose.yml)
(behind the `sync` profile, with the `sync-queue` named volume) and `sync-receiver` in
[`distribution/compose/central/docker-compose.yml`](../../distribution/compose/central/docker-compose.yml).

### 1.3 Change capture: Debezium on the database binlog

Not a choice: it is what `openmrs-watcher` does. The sender detects changes by reading the
database binary log via Debezium, not by polling OpenMRS tables and not by an in-process
OpenMRS event listener.

Why the binlog:

- It captures every change regardless of origin: REST, the O3 UI, Initializer, a support
  engineer's SQL. A change made outside the API is the change you most want to see
  in a national dataset.
- It has a resumable offset. A sender that restarts after four days resumes at the last
  committed offset rather than rescanning or losing the window.
- It does not add latency or failure modes to the clinical write path. A sender that is
  down must not be able to slow down a consultation.

Cost: it couples the sender to the OpenMRS physical schema, so a platform upgrade is a
sync-layer regression risk, and §1.1 shows we are already two minor versions past the
tested platform range. That is why the upgrade rehearsal in `qa/upgrade/` has to grow a
sync assertion before the second facility goes live.

> ⚠ **Required change, not yet made.** The facility `db` service does not enable binary
> logging. Debezium needs, on the database container command:
> `--log-bin --binlog-format=ROW --binlog-row-image=FULL --server-id=<unique-per-facility>`
> and a replication-privileged database user (`REPLICATION SLAVE`, `REPLICATION CLIENT`,
> `SELECT`) that is **not** the OpenMRS application user.

**Binlog retention is the real maximum-outage ceiling.** If the binlog is pruned past the
sender's committed offset, the facility needs a reconciliation replay (§5.5), not a retry;
the changes are simply gone from the log. DB-sync's own guidance is deliberately extreme
about this: *do not* set `expire_logs_days` at all on MySQL 5, and raise
`binlog_expire_logs_seconds` to **at least six months** on MySQL 8, against a 30-day
default. Adopt the six-month floor and size the disk for it. The cost of over-retaining is
disk; the cost of under-retaining is silent data loss discovered months later.

### 1.4 Transport: JMS via ActiveMQ Artemis

DB-sync publishes to a **JMS broker shared between sender and receiver**, with ActiveMQ
Artemis as the recommended and documented option. Its property templates assume Artemis.
Another JMS provider supported by Spring Boot and Camel is possible with modification; a
non-JMS transport is not, without replacing the sender's publish route.

**This overrides an earlier draft of this document, which specified HTTPS to
`EIP_CENTRAL_URL`.** That was reasoned from the topology: two facilities and one consumer
do not need a broker's fan-out, and the operational cost of a third stateful service is
real. The reasoning is not wrong; it is simply not ours to apply. Choosing HTTP means
writing our own publish route, our own delivery guarantee and our own retry state, and
thereby rebuilding the machinery §5 describes, which DB-sync already ships and which is
the main reason to adopt the module at all. **Take Artemis.** Revisit only if we end up
forking the sender for other reasons.

> 🛑 **Start order is a correctness requirement, not a preference.** DB-sync uses a
> **durable topic subscription**, and its documentation is explicit: the **receiver must
> connect before any sender publishes**. A sender that publishes to a topic with no durable
> subscriber **loses those messages**: silently, with no error at the facility and no retry,
> because from the sender's point of view the publish succeeded. This is the one failure in
> this document that defeats every other durability control we have, and it is caused by
> starting two containers in the wrong order. It belongs in the deploy runbook, in the
> compose dependency graph, and in the go-live checklist.

Consequences:

- **Central gains a `broker` service** (Artemis), with persistent storage, its own backup,
  and its own entry in the disaster-recovery runbook. It holds PHI in transit and at rest
  in its journal.
- **`EIP_CENTRAL_URL` on the facility `sync` service becomes a broker URL**, not an HTTP
  endpoint. The current variable name will mislead whoever configures it, so rename it.
- **Facility identity is still established by mutual TLS**, now on the broker connection:
  the facility presents a client certificate, and the broker authorises it. The facility
  code in a payload remains a label and is never trusted for authorisation.
- Artemis must not be exposed beyond mTLS-authenticated facilities. An open broker accepting
  clinical messages is the single worst failure available in this topology.

> ⚠ **Required change, not yet made.** The facility `sync` service mounts no TLS material,
> while `sync-receiver` mounts `${TLS_CERT_DIR}`. Mutual TLS needs the client half. Control
> D2 in [the SOP mapping](../security/moh-ict-sop-mapping.md) stays **Partial** until the
> facility mounts its client certificate and key and the certificate lifecycle is owned by
> the MOH ICT Unit in writing.

### 1.5 The sender's management database

DB-sync's sender keeps its own state (retry queues including `sender_retry_queue`, and the
Debezium offset) in a **management database separate from the OpenMRS database**. The
management database is documented as tested with MySQL and H2.

Our facility `sync` service is currently given `EIP_DB_HOST: db` and the OpenMRS
credentials, which is the *source* database, not the management one. Both are needed and
they are not interchangeable.

This is also the honest answer to "where does the durable queue live": it is the management
database plus the Debezium offset, not simply the `sync-queue` volume. Whatever backs that
database must be as durable as the volume, must survive a restart, and, because retry
payloads are clinical, holds PHI at rest (§5.2).

### 1.6 Entities pushed

Per the route inventory in
[`integration/eip/routes/README.md`](../../integration/eip/routes/README.md):
`patient`/`person`/`patient_identifier`, `visit`, `encounter`/`obs`,
`patient_program`/`patient_state`, `orders`. Plus the referenced metadata they depend on
(`location`, `provider`, `users`: as references, never as credentials).

**All five routes are covered by existing entity support.** The inventory was written
independently of DB-sync's coverage; checking it against `TableToSyncEnum` confirms 34
supported entities spanning every one of them. No custom entity development is required;
the work is configuration and verification. Full mapping, sync order and the dependency
chain: [Entity coverage and sync order](sync-entity-coverage.md).

Two entities need a decision rather than configuration:

- **`Order` subclasses** (`TestOrder`, `DrugOrder`, `ReferralOrder`): the models exist, but
  DB-sync documents that syncing them **fails**. A known defect, not missing support. If it
  reproduces on 4.0.0, defer `order-push` rather than build lab and pharmacy reporting on it.
- **`USERS`**: supported, but user rows carry credential material. Sync references only;
  never password hashes or secret answers.

**Metadata is not synced.** Concepts, locations and providers are delivered by the
content-package image, which facility and central share, so they hold identical UUIDs by
construction (ADR 0003). This satisfies DB-sync's stated assumption that metadata is centrally
managed, by a stronger mechanism than metadata sharing. It also creates a rule: **facility and
central must never run different content-package versions**, or the receiver will reject rows
referencing UUIDs it does not have.

**Not pushed:** anything from `content-demo`; anything from a facility running the demo
stack (`docker-compose.demo.yml` has no `sync` service, and that is deliberate: fabricated
patients must never reach central). Users' password hashes and secret answers are excluded
explicitly rather than by omission; a central copy of every facility's credential material
is a breach waiting for its incident report.

### 1.7 Wire format: DB-sync's native format for push, FHIR for reads

**Largely decided for us.** DB-sync serialises each changed entity (loaded by UUID) into
its own format. Pushing FHIR instead would mean replacing the sender's transform, and with
it the ordering and idempotency behaviour built around that format. The analysis below
survives as the reason the module's choice is also the right one, and as the justification
for using FHIR on the read paths, where nothing constrains us:

| | DB-sync native | FHIR resources |
| --- | --- | --- |
| Fidelity | Exact: replicates what OpenMRS stores | Lossy for obs groups, program states, some order attributes |
| Ordering / idempotency | Built in: UUID natural key, dependency handling | Must be re-implemented on top |
| MOH legibility | Low (it is an OpenMRS internal shape | High) a standard the MOH can hold us to |
| Reuse | Push only | Also serves cross-facility query and DHIS2 |

Use **DB-sync's native format for the replication push** and **FHIR for every read path**
(cross-facility query, DHIS2 export, any future national exchange). The push is
same-product replication (OpenMRS to OpenMRS) where fidelity matters more than
legibility, and `patient_program` / `patient_state` are where FHIR has no honest
mapping (`EpisodeOfCare` is a stretch, and MCH programme enrolment is core scope, not an
edge case). The read paths cross a product boundary, where the standard earns its cost.

FHIR resources in scope for the read paths, all served by the OpenMRS FHIR2 module:
`Patient`, `RelatedPerson`, `Encounter`, `Observation`, `Condition`, `AllergyIntolerance`,
`MedicationRequest`, `ServiceRequest`, `DiagnosticReport`, `Immunization`, `Location`,
`Practitioner`. Profiles and ValueSets live in
[`integration/fhir/`](../../integration/fhir/) and bind to CIEL concepts via `${var.*}`,
never a hard-coded UUID (IMPLEMENTATION.md §7).

### 1.8 Compatibility: three problems to resolve before Sprint 3

From the envelope in §1.1. None is an MOH decision; all three are ours, and all three can
invalidate the Sprint 3 plan if left until implementation.

**(a) MariaDB versus MySQL, the most serious.** Both compose files run `mariadb:10.11`.
DB-sync documents MySQL 5.7.x and 8.0.x and does not mention MariaDB. Debezium has since
split MariaDB out into a **separate connector** rather than serving it through the MySQL
one, so "MariaDB is a MySQL drop-in" is not a safe assumption at the binlog level, which is
the very level we depend on. This must be settled by experiment, not by argument:
stand up a facility stack, enable binlog, run the sender against MariaDB 10.11 and see
whether the Debezium engine attaches and streams. Three outcomes:

1. It works → record it as a tested-but-unsupported configuration, with the risk owned and
   the upgrade rehearsal covering it.
2. It works only on a newer Debezium with the MariaDB connector → establish whether the
   pinned DB-sync can carry that Debezium version.
3. It does not work → **switch both compose files to MySQL 8.0**, before go-live rather
   than after. OpenMRS supports MySQL; nothing in `content-packages/` depends on MariaDB.

Do this first. It is cheap to test and it changes the database platform of the whole
deployment, which is not a change to make after a facility is live.

**(b) Platform 2.8.8 versus the documented 2.5/2.6.** The sender reads the physical schema,
so the risk is concrete: a table or column that moved between 2.6 and 2.8 is a broken route,
not a warning. Establish whether a DB-sync version supporting 2.8.x exists. If not, the
choice is to contribute the compatibility work upstream, carry a fork, or, worst and to be
avoided, pin the platform back, which would undo [ADR 0006](../adr/0006-pin-o3-refapp-3.7.1.md)
and its reasoning about staying on the mainline. Budget for the first.

**(c) The receiver is not a point-of-care system.** DB-sync says so explicitly, because of
conflict-overwrite risk. Our central stack runs a full OpenMRS backend *and* frontend, and
Sprint 4 has clinicians reading from it.

This is compatible with our design, but only because of a property we must now state as a
rule rather than leave implicit: **central is read-only for clinical data.** No one
registers a patient, writes a note or places an order at central. Cross-facility query
(§6) reads; the identity layer (§2) writes only its own link table, never facility-owned
clinical rows. Enforce it with roles at central, not with convention: a single clinical
write at central is a conflict that the next facility push silently overwrites, and the
clinician who made it gets no error.

---

## 2. DECISION 1: Patient identity and matching across facilities

**This is a clinical safety decision.** Attaching one woman's obstetric history to another
is a patient-harm event, not a data-quality defect. It is recorded in
[ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md); this section is the
reasoning behind it.

### 2.1 The constraint nobody can design around

From
[`content-liberia-national/…/patientidentifiertypes.csv`](../../content-packages/content-liberia-national/configuration/backend_configuration/patientidentifiertypes/patientidentifiertypes.csv):

| Identifier | Required | Uniqueness | Consequence |
| --- | --- | --- | --- |
| MOH Health Record Number | **yes** | **LOCATION** | Facility-scoped. Careysburg and Barnersville will both issue `00001`. **Cannot be the cross-facility key.** |
| Liberia National ID | no | UNIQUE | Globally unique *when present*: and it is optional at registration, so it will often be absent. |
| ANC Number | no | LOCATION | Programme register number, facility-scoped. |

So: the mandatory identifier is not unique across facilities, and the unique identifier is
not mandatory. There is no existing key that identifies a person nationally. That is the
whole problem, and it is a property of the MOH's registration policy, not of our design.

### 2.2 Recommendation: central-assigned identifier, link never merge

1. **Central assigns a Central Person Identifier (CPI)** on first receipt of a patient.
   It is generated by central, never typed by a clinician, never printed on a card in this
   release. It exists so that central has one stable key per *person*, distinct from the
   per-facility keys it receives.

2. **Central links, it does not merge.** Facility records are stored exactly as sent. A
   separate link table maps `(facility_code, patient_uuid) → CPI`. A wrong link is undone
   by editing one row; a wrong merge has already destroyed the evidence needed to detect it.
   This single property is what makes an imperfect matcher safe to operate.

3. **Three-band matching**, never a single threshold:

   | Band | Action | Reversible |
   | --- | --- | --- |
   | High confidence | Auto-link to existing CPI | Yes (link table) |
   | Middle band | **Human review queue**: no link until a person decides | n/a |
   | Low | New CPI | Yes |

   The middle band is the design. A system with only "match" and "no match" is a system
   that has decided to be silently wrong in one direction or the other.

4. **Deterministic rules first.** Exact National ID match → auto-link, *but* gated on a
   demographic sanity check: sex must agree and DOB must agree within tolerance. A National
   ID that matches while sex disagrees is a transcription error or a shared ID, and it
   belongs in the review queue, not in an auto-link.

5. **Probabilistic scoring for everyone else** (Fellegi–Sunter style, field weights tuned
   on real Liberian registration data, not guessed at design time):
   surname and given name (normalised, phonetic + edit distance), date of birth, sex,
   mother's name, phone number, residence district, and, as evidence of a *different*
   person rather than the same one, a facility-scoped MOH HRN that is already linked to a
   different CPI at the same facility.

6. **Never auto-link on name + date of birth alone.** In MCH this is not a theoretical
   false positive: **twins** share surname, date of birth, sex often enough, mother's name,
   phone number and facility. Name + DOB is the most dangerous rule available and it
   must be scored into the review band, never the auto band.

### 2.3 Local realities the scoring must respect

- **Estimated dates of birth.** OpenMRS records `birthdate_estimated`; a large share of
  registrations will carry it. An estimated DOB must contribute far less weight than a
  documented one, and an estimated-vs-estimated agreement must contribute least of all.
  Ignoring the flag manufactures confidence out of a clerk's best guess.
- **Name variability.** Spelling and transliteration vary between clerks and between
  visits. Match on a normalised, phonetically encoded form, and keep the raw string.
- **Common surnames** are common enough that surname agreement is weak evidence. That is
  what frequency-weighted scoring is for.
- **Shared phone numbers** across a household, a strong-looking field that is routinely
  not personal. Weight accordingly.

### 2.4 What MOH ICT must decide

- **Is a central identifier scheme acceptable**, or does the MOH intend the National ID to
  become mandatory at registration? If National ID becomes mandatory, most of §2.2 stays
  (matching is still needed for the pre-existing records and for the error cases) but the
  auto-link band grows substantially.
- **Who owns the review queue?** It must be a named MOH role with a service-level
  expectation, not "the facility". Facility staff cannot adjudicate a duplicate they cannot
  see; the second record is at another facility. An unstaffed review queue is the same
  thing as no matching at all, only more expensive.
- **Thresholds** are set from real data during Sprint 3, reviewed with MOH ICT, and
  recorded. They are configuration, not a code constant.

### 2.5 The Central Person Identifier: generation, storage and attachment

How central actually mints the CPI and attaches it to records. This is the mechanism behind
§2.2; the policy is in [ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md).

#### 2.5.1 Format: opaque, checked, meaningless

The CPI carries **no semantic content**. No facility code, no birth year, no sex, no
sequence that reveals volume.

- Internally the CPI is an opaque key (UUID). Nothing in the system parses it.
- A human-readable form exists for the day it is ever printed or spoken:
  **`LR-XXXXX-XXXXX-C`**: Crockford base32 (which excludes `I`, `L`, `O` and `U`, so it
  survives handwriting and dictation) with a trailing **check character**.

Two reasons this matters, and both have burned national identifier schemes before:

- **Embedded meaning leaks and then breaks.** An identifier encoding the facility discloses
  where someone sought care, a disclosure in the identifier itself, on every record it
  appears on. It also becomes wrong the moment a patient attends elsewhere, and nobody
  re-issues identifiers.
- **A check character catches transcription errors at the point of entry** rather than
  creating a phantom person. If the CPI is ever typed by a human, this is the difference
  between a rejected entry and a new duplicate.

#### 2.5.2 Generation: who, when, and never twice

- **Central generates. Facilities never do.** A facility cannot know whether a person
  already exists elsewhere, which is the entire point.
- **Every incoming patient receives a CPI on first receipt**, before matching completes. No
  record is ever left unidentified while it waits in a review queue, and matching is free to
  be asynchronous.
- **CPIs are never reused and never deleted.** When matching later links two records, one
  CPI becomes the **primary** and the other is retained as an **alias** that resolves to it,
  permanently.

That last rule is what makes the whole scheme reversible. A wrong link is undone by changing
which CPI is primary; nothing is destroyed, and any record, log line or audit entry that ever
referenced the alias still resolves. Deleting or re-using an identifier destroys the
evidence needed to detect and correct the mistake.

```
  Careysburg patient  ──▶ CPI-A ──┐
                                  ├──▶ primary: CPI-A   (CPI-B alias ▸ CPI-A, forever)
  Barnersville patient ─▶ CPI-B ──┘

  Link reversed later?  primary becomes CPI-B; CPI-A becomes the alias.
  Nothing is deleted. Every historical reference still resolves.
```

#### 2.5.3 Storage: outside the replicated tables, and this is not optional

**The CPI and the link table live in a separate identity schema at central, not in
central's OpenMRS tables.**

The reason is dbsync's conflict model. Central's OpenMRS database is a **replica maintained
by the receiver**, and dbsync detects conflicts by comparing modification dates: if a row was
edited at central more recently than the incoming payload, the message is diverted to
`receiver_conflict_queue` and requires manual resolution. So writing a CPI into
`patient_identifier` at central would:

1. Modify replicated rows that central does not own, and
2. Generate conflict-queue entries on the next facility update to that patient, so routine
   clinical edits turn into manual conflict resolution, at volume, forever.

Keeping identity in its own schema means the replica stays a clean replica, the identity
layer stays independently backed up and audited, and, per the [module
evaluation](sync-module-evaluation.md) §3, a national client registry can later take over
that schema's role without touching the replica.

| | Facility OpenMRS DB | Central OpenMRS DB (replica) | Central identity schema |
| --- | --- | --- | --- |
| Written by | Clinicians | dbsync receiver **only** | Identity service **only** |
| Holds the CPI | ❌ (one-way sync) | ❌ (would cause conflicts) | ✅ |

#### 2.5.4 Attachment: how the CPI reaches a record

Because sync is one-way, **the CPI is attached at read time, not written back**:

- **Central read APIs** expose it as an additional `Patient.identifier` on the FHIR
  representation, assembled from the link table. The replica is not modified.
- **Cross-facility query** (§6) resolves the local patient → CPI → linked records, and the
  clinician never sees or types the CPI.
- **DHIS2 export and national reporting** use the CPI as the de-duplication key, which is
  what stops one person being counted twice in national MCH figures.
- **The facility record never carries the CPI** in this release. The facility keeps its own
  view; see §4.3.

If the MOH later wants the CPI printed on a patient card or written into the facility
record, that is a **second write direction** and needs its own ADR; it is not a
configuration change, and it should not be presented as one.

---

## 3. DECISION 2: Pulled-record scope

**This is a legal and proportionality decision** under the draft Data Protection Act, and a
clinical-usefulness one. Recorded in [ADR 0007](../adr/0007-pulled-record-scope.md).

### 3.1 Options

| Option | Clinical value | Exposure |
| --- | --- | --- |
| A: Demographics only | Low. Confirms identity, changes no decision. | Minimal |
| B: Demographics + defined clinical summary | High for the decisions actually made at the point of care. | Bounded, and the bound is written down |
| C: Full clinical history | Marginal above B; more to read, not more to act on. | Every historical observation, to every facility |

### 3.2 Recommendation: Option B

Demographics plus a **named, enumerated summary**:

- Active problems / conditions
- Allergies and intolerances
- Current medications
- Immunisations
- MCH programme enrolments and current state (ANC, Labour & Delivery, PNC, Family Planning)
- Last ANC contact summary: gestational age, key risk flags, next scheduled contact
- Encounter *index*: dates, types, facility, **without** the observations inside

Rationale: it is the set a clinician acts on in the first five minutes with an unknown
patient, it is defensible under data minimisation and purpose limitation, and, because it
is an enumerated list rather than "the record", it is auditable. Someone can check whether
the system does what the policy says. "Clinical history" cannot be checked against
anything.

The encounter index without contents is deliberate: it tells a clinician that care happened
elsewhere and lets them request more through an existing human channel, without shipping
every observation by default.

### 3.3 Conditions attached to Option B

- **Query, never replicate.** The querying facility renders the remote record; it does not
  copy it into its local database. Restated from
  [`integration/cross-facility/README.md`](../../integration/cross-facility/README.md)
  because it is the guarantee that makes the scope meaningful: a scope you can copy is a
  scope you no longer control.
- **Patient-scoped, never bulk.** A query is only valid against a single resolved patient
  in the context of an active clinical interaction. There is no export, no list, no "all
  patients at Barnersville".
- **Reason for access captured** at the moment of the query and stored with the audit
  record. It costs the clinician one interaction and it is the difference between an audit
  log that shows *that* a record was read and one that shows *why*.
- **Every access audited** with user, facility, patient, timestamp, reason and the fields
  returned, feeding control C1, and readable only by the ICT Auditor role (control B3).
- **Sensitive-category carve-outs are the MOH's to name.** If any category (for example HIV
  status) is to be excluded from cross-facility visibility, it must be named before build,
  because it is a filter at the boundary and a concept-set decision in the content
  packages, not something to retrofit.

### 3.4 What MOH ICT must decide

Confirm Option B and its enumerated list; name any sensitive-category exclusions; confirm
the lawful basis and whether patient consent is required at query time or covered by the
care relationship; confirm retention of the audit trail (≥3 months per control C2, likely
longer for cross-facility access). Final scope to be re-checked against the Data Protection
Act as enacted; this document does not assume its final text.

---

## 4. DECISION 3: Offline registration and duplicate reconciliation

### 4.1 Registration never waits for central

A clerk registers a patient with no link to central. The patient UUID is generated locally
and is the natural key from that moment. The CPI is assigned later, asynchronously, when
the record reaches central. **No registration, search or clinical workflow may block on a
CPI being present**: an offline-first EMR that needs the network to register a patient is
not offline-first.

### 4.2 Two different duplicate problems

| | Within one facility | Across facilities |
| --- | --- | --- |
| Visible to | Facility staff | **Central only** |
| Cause | Search missed the existing record | No shared identifier at registration |
| Fix | Local merge, by facility staff, at the facility | Link at central, by the MOH review role |
| When | Immediately | On receipt, then on review |

**Within a facility:** prevention beats reconciliation. O3 registration searches before it
creates; the work is making that search actually find things: phonetic matching on the
normalised name, tolerant date-of-birth handling, and search on ANC number and phone, not
only on the MOH HRN. A local merge is a normal OpenMRS operation and the merge is itself a
change that syncs to central.

**Across facilities:** only central can see it, so only central can resolve it (§2.2).

### 4.3 The consequence of one-way sync, stated plainly

Sync is unidirectional in this release, so **a link made at central does not propagate back
to the facility.** The facility keeps its own view of the patient and never learns that
central has linked it to a record at another facility.

This is a real limitation and it needs to be understood rather than discovered:

- It is acceptable for Sprint 3, because in Sprint 3 nothing at the facility reads
  cross-facility data.
- It is resolved at *read* time in Sprint 4: cross-facility query resolves the local
  patient to a CPI at central and returns the linked view. The facility's local database
  still holds only its own records, which is the query-not-replicate rule from
  §3.3, arriving at the same answer from the other direction.
- If the MOH later wants the link reflected in the facility database, that is a **second
  write direction** and a new ADR. It is not a configuration change and it should not be
  presented as one.

---

## 5. Offline behaviour, retry and delivery guarantees

### 5.0 When sync happens

**Continuously, and never on a schedule.** There is no nightly batch and no "sync now"
button. The Debezium engine streams committed changes as they happen, so when the link is up
a change reaches central within seconds of being recorded, and when the link is down the same
changes accumulate in order and drain automatically on reconnection.

This matters for three reasons:

- **Nobody has to remember to sync.** A scheduled or manual sync is a control that fails
  quietly the week a facility is busy, which is the week the data matters most.
- **The backlog after an outage is proportionate to the outage**, not to a batch window, so
  there is no nightly spike for the receiver to absorb.
- **Recovery needs no facility-side intervention.** A clinic that has been offline for three
  weeks reconnects and drains without a visiting engineer. That is a hard requirement for
  facilities that are a day's travel away, and it is tested in §5.9.

The one operational rule: **the receiver must be running and subscribed before any sender
publishes** (§1.4). That is a start-order constraint at central, not a facility action.

### 5.1 Guarantee

**At-least-once delivery, idempotent upsert on the OpenMRS UUID, therefore effectively-once
in effect.** Exactly-once delivery is not available across an unreliable link and is not
worth pretending to. The upsert is what makes at-least-once safe.

### 5.2 Queue

**Read this section as configuration and verification, not as a build list.** DB-sync
already implements the durability, retry and ordering machinery below, verified in source:
sender and receiver retry queues, a conflict queue, per-entity hash tables, a cleaner task
and a Prometheus metrics endpoint. That is the main reason to adopt it. What follows states the behaviour we require; the Sprint 3 task is to
configure the module to it and to prove each property by test, replacing anything it does
not already give us. Building it fresh would be rebuilding the module.

Durable state is in three places, and all three must survive a restart together: the
sender's **management database** (retry queues, §1.5), the **Debezium offset**, and the
**broker's journal** at central (§1.4). The `sync-queue` volume is one part of this, not the
whole of it.

**All three hold unencrypted PHI at rest.** They are therefore in scope for the backup
encryption control (D3) and for the disaster-recovery runbook. This is easy to miss because
they look like infrastructure rather than data. A backup that captures the OpenMRS database
but not the management database restores a facility that has silently forgotten what it
still owed central.

### 5.3 Ordering

Per-patient FIFO, keyed on patient UUID. Global ordering across patients is not required
and buying it would serialise the whole push behind the slowest record.

Confirm DB-sync's actual ordering and dependency behaviour before assuming the rest of this
subsection needs implementing: a receiver that already parks unresolved dependencies needs
configuring and testing, not writing.

Dependencies still arrive out of order in practice (a visit whose patient has not landed).
The receiver **parks** such a message in a bounded pending-dependency queue and retries it
when the dependency arrives; it does not reject it, and it does not stall the stream
behind it. Parked messages older than a configured age are an alert: they mean something
upstream was dropped, and they are the earliest visible symptom of it.

### 5.4 Retry: retryable versus poison

The distinction that matters:

| Class | Examples | Policy |
| --- | --- | --- |
| **Retryable** | Connection refused, timeout, TLS handshake, broker unavailable, receiver at capacity | Retry indefinitely, exponential backoff with jitter, capped (5 min). This is the offline case and it is normal. |
| **Poison** | Schema violation, referential integrity failure, deserialisation error | **Bounded** retries, then dead-letter. Raise an operational alert. |

Retrying a poison message forever is how a queue stops draining while every dashboard
reports "retrying". The dead-letter queue is inspected by a person; a message in it is a
defect, and it is never silently discarded.

Backoff must be jittered, and it matters here: two facilities coming back online together
after a regional outage should not synchronise their retry storms against a receiver that
is itself just starting.

### 5.5 Reconciliation: because retries do not prove completeness

A retry loop proves that what entered the queue eventually left it. It proves nothing about
what never entered: a missed binlog window, a pruned log, a restore from backup, an offset
reset.

**The building block already exists**: DB-sync maintains per-entity hash tables on both
sides (`*Hash`, `HashBatchUpdater`), which is the primitive a parity check needs.
What does not exist is the periodic report over them.

So: a **scheduled reconciliation job** compares per-entity, per-day counts and content
hashes between facility and central, and reports divergence. Divergence triggers a targeted
replay by UUID range, not a full re-sync. Without this, silent data loss is invisible until
someone notices a facility's ANC numbers look low in a DHIS2 report, months later, with no
way to tell when it started.

### 5.6 Operational limits and alerts

| Signal | Meaning | Action |
| --- | --- | --- |
| Queue depth over threshold | Extended outage or receiver rejecting | Ops alert. **Never a clinical alert.** |
| Queue disk over threshold | Approaching the real outage ceiling | Escalate before it is reached |
| Oldest unacknowledged message age | The true "how far behind is this facility" number | Dashboard metric, per facility |
| Dead-letter queue non-empty | A defect exists | Human inspection |
| Conflict queue non-empty | Central's row is newer than an incoming payload | Human resolution: and if it is not rare, something is writing at central that should not be |
| Parked-dependency message aged out | Something upstream was lost | Investigate; likely reconciliation |
| Binlog retention approaching sender offset | Replay territory, not retry territory | Urgent |

**Sync failure is never surfaced to a clinician.** A facility with a four-day queue is a
facility working exactly as designed.

### 5.7 Clock skew

Facility hosts will drift; some will be badly wrong after a power event. Preserve
facility-recorded clinical timestamps as clinical data, and use central receipt order for
sync bookkeeping. Never mix the two. NTP on facility hosts is an operations requirement in
the go-live runbook, not an assumption this design gets to make.

### 5.8 Queue retention after successful push

Open item 4 in
[`integration/eip/routes/README.md`](../../integration/eip/routes/README.md). Recommendation:
purge the **payload** immediately on acknowledgement (it is PHI with no further purpose)
and retain **metadata only** (UUID, entity type, timestamp, content hash) for a configurable
window long enough to serve §5.5 reconciliation. Retaining payloads "just in case" turns
the facility queue into a second uncontrolled copy of the record.

### 5.9 The guarantee, and everything that could still break it

The requirement is blunt: **a satellite facility with poor connectivity must lose nothing,
and must fully reconcile with central once the link is stable, however long the gap.**
Retry logic alone does not deliver that. Below is every way the guarantee can still fail,
and what closes each. Nothing here is theoretical; each one has a specific trigger.

| # | Failure | Trigger | Result if unclosed | Closure |
| --- | --- | --- | --- | --- |
| F1 | **Binlog pruned past the sender's offset** | Outage longer than binlog retention | **Silent permanent data loss** | Six-month retention floor (§1.3); alarm when retention margin approaches the sender's lag |
| F2 | **Facility disk fills**: binlog plus queue plus retry payloads grow all outage | Long outage on a small disk | **The database stops accepting writes and care stops.** The worst outcome in this document, and it is caused by the sync layer | Size the disk for the full retention window; put binlog on its own volume; alarm at 60/75/85%; a documented emergency procedure that sheds sync state, never clinical data |
| F3 | **Management database lost or restored from an older backup** | Facility disk failure, bad restore | Offset regresses (harmless duplicate sends) or jumps forward (**silent gap**) | Back up the management database with the OpenMRS database, at the same point in time; treat any restore as requiring a reconciliation run |
| F4 | **Certificate expired during the outage** | Long outage crossing an expiry date | Facility cannot reconnect **at the moment connectivity returns** | Long-lived certs, expiry alerting at 90/60/30 days, central-side revocation for containment (§7.6) |
| F5 | **Stale message overwrites fresher data** | Replay or long-delayed delivery | Silent clinical regression at central | Reject updates older than what central holds (§7.5) |
| F6 | **Poison message blocks the queue head** | One malformed or unsupported entity | The facility appears to be retrying forever and never drains | Bounded retries then dead-letter, and the stream continues (§5.4) |
| F7 | **Central never notices a facility has gone quiet** | Facility down, sender crashed, or nothing to send | An outage that nobody is counting is an outage nobody fixes | Facilities send a heartbeat; central alerts on silence, per facility, distinguishing "no data" from "no contact" |
| F8 | **Everything retried successfully but records still missing** | Any of F1–F3, or a bug | Loss discovered months later in a DHIS2 report | Scheduled reconciliation by count and hash (§5.5). **This is the only control that detects loss rather than preventing it, which is why it is not optional** |
| F9 | **Reconnection storm** | Regional outage ends; all facilities return at once | Receiver overwhelmed; the first facilities to reconnect starve the rest | Jittered backoff and per-facility rate limiting at central (§7.6) |
| F10 | **Facility server stolen or dies outright** | Physical | Loss of the local record and its credentials | Facility backups (existing runbook), full-disk encryption (§7.4), certificate revocation at central (§7.2) |

Two of these deserve emphasis because they are the ones that get deferred:

- **F2 is the only failure in this document where the sync layer can stop clinical care.**
  Everything else in the design is arranged so sync failure is invisible to a clinician, and
  a disk filled by six months of binlog defeats all of it. Disk sizing is therefore a
  clinical-safety requirement, not a capacity-planning detail, and it belongs in the
  hardware specification for every facility, including the ones not yet built.
- **F8 is the difference between believing the guarantee and knowing it.** Retries prove
  that what entered the pipeline left it. Only reconciliation proves that what was recorded
  at the facility exists at central. Until the reconciliation job runs and reports zero
  divergence for a facility, that facility's sync is unverified regardless of how healthy
  the queues look.

**Acceptance test for the guarantee**, to be run in `qa/` before go-live and repeated for
each new facility, not argued on paper:

1. Bring a facility up, sync, confirm parity with central.
2. Sever the link. Record a realistic clinical day: registrations, visits, encounters,
   observations, programme enrolments.
3. Keep it severed **well past the longest outage the MOH expects to tolerate**, with disk
   consumption monitored throughout (F2), and cross a certificate-renewal boundary if the
   lifetime allows (F4).
4. Restore the link with **no manual intervention at the facility**. A facility that needs a
   visiting engineer to resume syncing does not meet the requirement.
5. Assert: everything drains, reconciliation reports zero divergence, no duplicates, no
   stale overwrite, and nothing anywhere in the logs contains PHI (control C3).
6. Repeat with two facilities restored simultaneously (F9), and once with the management
   database restored from an older backup (F3).

### 5.10 Initial load: the first sync of an existing database

Change capture only sees changes. A facility that has been running before its sender is
installed (Careysburg's pilot data, or any facility onboarded after go-live) has existing
rows that no binlog event will ever describe.

The mechanism exists: the watcher exposes Debezium's snapshot modes (`TRUE`, `FALSE`,
`LAST`), and a snapshot emits every existing row as an event through the same pipeline. What
does not exist yet is a plan for it, and an unplanned snapshot is a bulk operation with real
consequences: an entire clinical database flowing through the broker in one drain, hash
tables being built for every record, and central applying months of history while other
facilities sync live.

Rules for the first load:

- **Snapshot before go-live, not after.** The initial drain happens during onboarding, while
  the facility is not yet depending on the pipeline and central can dedicate capacity to it.
- **One facility at a time.** Two initial loads competing with live traffic is the F9
  reconnection-storm problem, self-inflicted.
- **Verify with reconciliation, not with completion.** The load is finished when the parity
  report (§5.5) shows zero divergence, not when the queue is empty.
- **Confirm snapshot behaviour in the spike** (E1): the snapshot is taken by the same
  Debezium engine whose MariaDB compatibility is unproven, so the spike must exercise both
  streaming and snapshot modes.

---

## 6. Cross-facility query flow (Sprint 4)

A read path. It introduces no second write direction.

```
  Clinician at Careysburg, patient in front of them
        │
        │ 1. Local search first, always
        ▼
  Local record found? ──yes──▶ Normal chart. Remote lookup is offered, never automatic.
        │ no / incomplete
        ▼
  2. "Check other facilities", an explicit action, with reason-for-access captured
        │
        ▼ (mTLS, patient-scoped)
  Central: resolve local patient → CPI via the link table
        │
        ├─ no link, no candidate ──▶ "No records found at other facilities"
        │                             (an answer, not an empty chart)
        ├─ middle-band candidates ──▶ "Possible match pending review" + queue it.
        │                             NOT auto-linked, NOT shown as this patient's record.
        └─ linked CPI ─────────────▶ 3. Assemble §3.2 summary as FHIR from linked records
                                          │
                                          ▼
  4. Render read-only, clearly labelled with source facility and retrieval time.
     Never written to the local database.  Access written to the audit log.
```

Behaviour that has to be right:

- **Offline degrades to a clear message**, never a spinner and never a silently empty
  result. "No link to central, remote records unavailable" and "No records at other
  facilities" are different statements and must never render identically. A clinician
  reading the first as the second concludes a patient has no history when the truth is that
  nobody looked.
- **Remote data is visually distinct and read-only.** It carries the source facility and
  the retrieval timestamp. A clinician must always be able to tell what came from where.
- **A middle-band candidate is never rendered as the patient's record.** It is a statement
  that a possible match exists and is under review; surfacing it as history is
  the wrong-attachment failure that §2 is built to prevent.
- **Every access audited**, including the ones that return nothing.

---

## 7. Security

The threat model is set by the deployment, not by the software: **facility servers sit in
health centres, not in a data centre.** They are physically reachable by many people,
unattended overnight, on unreliable power, and they hold a complete copy of a facility's
clinical record. The link to central is intermittent by design. Every control below follows
from that.

### 7.1 The two axes, and the rule that keeps them apart

The most important security property of this design, and the one easiest to get
backwards under delivery pressure:

> **Security fails closed. Clinical availability fails open. They are different axes and
> neither may be traded for the other.**

- If authentication, authorisation or transport security cannot be established, the sync
  layer **stops and queues**. It never downgrades to plaintext, never skips certificate
  verification, never falls back to an unauthenticated endpoint, and never has a
  "temporarily disable TLS" switch, because a switch that exists in a config file is a
  switch that gets set at 2am during an outage and never gets unset.
- If central is unreachable for any reason at all, the facility **keeps delivering care**.
  Registration, examination, prescribing and the e-partograph do not consult central and do
  not degrade.

A failure to sync is never a clinical event, and a security failure is never resolved by
weakening the control. Those two sentences are the whole policy.

### 7.2 Identity of a facility

Each facility holds a distinct client certificate and distinct broker credentials. Nothing
is shared between facilities; a shared credential makes revocation collective punishment
and makes the audit trail unable to answer "which facility sent this".

- **Authorisation comes from the authenticated certificate**, never from the payload. The
  facility code in a message is a label. The receiver rejects any message whose claimed
  facility does not match the authenticated identity of the connection that carried it,
  and rejection is an alert: it is either a misconfiguration or an attempt.
- **Enrolment is out-of-band.** A new facility's certificate is issued through an MOH ICT
  process and installed by a person. There is no self-service enrolment endpoint; an
  automated one is a way to become a facility.
- **Revocation must work while the facility is offline**: which it does, because
  revocation is enforced at central. A stolen facility server cannot be reached to have its
  credential removed, so the CRL/OCSP check at the broker is the control that actually
  matters. Test that a revoked certificate is refused before go-live; an untested
  revocation path is not a control.

### 7.3 Broker authorisation: the trap in a shared broker

A shared broker is the correct topology and it introduces one failure with national
consequences: **a facility that can read from the broker can read other facilities'
clinical data.** Getting the permissions wrong is a single line of configuration and it
silently converts a sync bus into an inter-facility data-leak channel.

Therefore, per facility:

- **Send-only** permission, on **its own address only**. No consume, no browse, no
  wildcard, no management access, no ability to create addresses or queues.
- **Only the receiver at central consumes.**
- Verify by test, from a real facility credential, that reading another facility's address
  and consuming from the receiver queue both **fail**. Assert it in `qa/`. A permission
  model that has only ever been checked by reading the config file has not been checked.

The broker is never exposed beyond mTLS-authenticated facilities, and its management
interface is not exposed at all.

### 7.4 Data at rest: five copies, not one

PHI exists at rest in more places than the OpenMRS database, and each is a full or partial
copy of the clinical record:

| Location | Holds | Consequence |
| --- | --- | --- |
| Facility OpenMRS database | Everything | Obvious; already in scope |
| **Facility binlog** | Every change, up to six months (§1.3) | Often overlooked: it is a rolling plaintext change log of the whole record |
| **Sender management database** | Retry payloads (§1.5) | Clinical content, indefinitely if a message is stuck |
| **Broker journal at central** | In-flight messages | Clinical content |
| **Backups of any of the above** | Everything | Control D3 |

So: **full-disk encryption on facility hosts** (the server is stealable, and a stolen disk
yields the database *and* six months of binlog *and* the client certificate), encryption of
backups (D3), and the private key protected by file permissions and never in the repo (D4,
already enforced by `scripts/validate/no-secrets.sh`).

Dead-letter messages contain PHI. Inspecting them is a clinical-data access: it happens in a
controlled place, by a named role, and it is audited. It is not a matter of someone tailing
a log.

### 7.5 Integrity: stale data must not overwrite fresh

Idempotent upsert on UUID (§5.1) makes a **replay** harmless in the duplication sense, but
not automatically harmless in the content sense: replaying an old message could overwrite a
newer version of the same record with an older one. Central therefore rejects an update
whose source version or source timestamp is older than what it already holds, and counts
the rejection. Without that check, "at-least-once plus idempotent upsert" quietly means
"last to arrive wins", and after a long outage the last to arrive is frequently the oldest.

### 7.6 Reconnection after an outage

The behaviour that only ever gets exercised in production, and the one this deployment will
exercise constantly:

- **Backoff is jittered** (§5.4). Facilities restored by the same regional event must not
  reconnect in lockstep against a receiver that is itself just starting.
- **Central rate-limits per facility** so that one facility draining a two-week backlog
  cannot starve another facility's live sync. Fairness here is an availability control.
- **Backlog drain is resumable.** An interruption mid-drain resumes at the offset, and does
  not restart the backlog.
- **Certificate expiry is checked ahead of time and alerted on well before it happens.**
  This is the sharpest edge in the whole design: a certificate that expires *during* a long
  outage means the facility cannot reconnect **at the moment connectivity returns**: the
  exact moment the design exists to serve, and it will be discovered by a person standing
  in front of a health centre server. Use long-lived facility certificates, alert at 90/60/30
  days, and rely on central-side revocation (§7.2) rather than short lifetimes for
  containment.
- **Clock skew is a security control, not only an ordering one** (§5.7). A facility whose
  clock is badly wrong after a power event will misjudge certificate validity in one
  direction or the other. NTP is a go-live requirement.

### 7.7 Payload encryption: defence in depth, already built

DB-sync ships **PGP-style payload encryption** independent of TLS
(`SenderEncryptionProperties` / `ReceiverEncryptionProperties`: a key folder, a user id, a
passphrase, and the receiver's user id). Enable it.

TLS protects data **in motion between two endpoints**. It does nothing for data sitting in
the broker's journal, in a retry queue, or in a backup of either. Payload encryption means a
message is readable only by the receiver that holds the private key, so a compromised
broker, a stolen backup tape or an operator with filesystem access sees ciphertext.

This makes key management an MOH ICT responsibility alongside the certificate lifecycle:
key generation, distribution to each facility, storage, and rotation. Encryption whose keys
nobody owns is a checkbox, not a control. **A lost receiver private key makes every queued
message unreadable**: so key custody and backup are part of the disaster-recovery runbook,
not an afterthought.

### 7.8 Control mapping

| Control | Where it lands here |
| --- | --- |
| D1: TLS 1.2+ | Every facility↔central hop, including the broker connection |
| D2: Mutual TLS | Per-facility client certificate on `sync`; broker authorises on certificate subject; revocation enforced at central. **Requires the §1.4 change.** Certificate lifecycle is the MOH ICT Unit's |
| C1 / B3: Audit | Sync outcomes, rejected messages, dead-letter access and every cross-facility access; readable by the ICT Auditor role only |
| C3: No PHI in logs | Log UUID, entity type and outcome. Never a name, an identifier value or an observation value: including in error and dead-letter logs, which is where it usually leaks |
| D3: Encrypted backups | Extends to the binlog, management database, broker journal and `sync-queue`: all five copies in §7.4 |
| D4: No secrets in the repo | Facility credentials and keys live in `.env` and mounted files; already enforced in CI |
| **New**: Payload encryption | PGP keys per facility, receiver key custody and rotation owned by MOH ICT (§7.7) |
| **New**: Facility disk encryption | Not currently in the SOP mapping. §7.4 makes it necessary; raise it with MOH ICT |

---

## 8. Open questions for MOH ICT (sign-off by 21 August)

| # | Question | Blocks |
| --- | --- | --- |
| 1 | Central-assigned CPI accepted, or National ID to become mandatory at registration? | ADR 0005, Sprint 3 |
| 2 | Named MOH role owning the duplicate review queue, with an expected turnaround | ADR 0005, go-live |
| 3 | Pulled-record scope: Option B and its enumerated list confirmed? | ADR 0007, Sprint 4 |
| 4 | Sensitive categories excluded from cross-facility visibility, if any | ADR 0007, content packages |
| 5 | Lawful basis, and whether patient consent is captured at query time | ADR 0007 |
| 6 | Certificate lifecycle ownership, in writing (control D2) | Sprint 3 |
| 7 | Maximum tolerated facility outage: sets binlog retention and queue disk sizing | §1.3, hardware spec |
| 8 | Audit retention for cross-facility access (≥3 months, likely longer) | Control C2 |
| 9 | Full-disk encryption on facility servers: accepted as a control, and whose responsibility to apply and verify? | §7.4, control register |
| 10 | Confirmation that facility hardware will be sized for the §5.9 retention window, including facilities not yet built | F2, hardware spec |

Question 7 is the one that quietly sets the most: it fixes binlog retention, facility disk
size and the acceptance test in §5.9. An answer of "we don't know" should be treated as the
longest plausible outage, not the shortest: under-sizing fails as F1 or F2, both severe,
while over-sizing costs disk.

## 9. Engineering risks we own (not MOH decisions)

These do not go to the sign-off meeting. They are ours, they are all in §1, and any of them
can invalidate the Sprint 3 plan.

| # | Risk | Resolve by | Severity |
| --- | --- | --- | --- |
| E1 | MariaDB 10.11 versus DB-sync's documented MySQL 5.7/8.0: Debezium now treats MariaDB as a separate connector | Experiment, before anything else is built (§1.8a) | **Highest**: may change the database platform of the whole deployment |
| E2 | Platform 2.8.8 versus documented 2.5/2.6: the sender reads the physical schema | Establish DB-sync 2.8.x support; budget upstream work (§1.8b) | High |
| E3 | `order-push` sits on DB-sync's known-defective `Order` subclasses | Reconcile the route inventory with DB-sync's coverage; consider deferring (§1.6) | High: sets lab/pharmacy scope |
| E4 | Neither `openmrs-eip` nor DB-sync is version-pinned anywhere | Pin both, as their own artefacts (§1.1) | Medium |
| E5 | Artemis broker and sender management database do not exist in the compose files | Add both (§1.2) | Medium |
| E6 | Central is only safe if clinical data there is read-only, and nothing enforces that | Enforce with roles at central (§1.8c) | Medium |
| E7 | A shared broker with wrong permissions lets one facility read another's clinical data | Send-only, own-address-only per facility, **proven by a negative test in `qa/`** (§7.3) | **Highest**: national-scale data leak from one config line |
| E8 | Facility disk filled by binlog and queue during a long outage halts the database | Size disk for the full retention window; separate binlog volume; alarms (F2) | **Highest**: the only path where sync stops care |
| E9 | Facility disk encryption is not in the SOP mapping, and facility servers are physically exposed | Raise with MOH ICT; add to the control register (§7.4) | High |
| E10 | Nothing detects a facility that has silently stopped syncing | Per-facility heartbeat and silence alerting (F7) | High |
| E11 | **Sender publishes before the receiver has subscribed → messages lost silently** | Durable topic subscription; enforce receiver-first start order in compose and the runbook (§1.4) | **Highest**: defeats every other durability control |
| E12 | Facility and central drift onto different content-package versions | Same image both sides; assert UUID parity in the upgrade rehearsal (§1.6) | Medium |
| E13 | PGP key custody unassigned; a lost receiver key makes queued messages unreadable | Assign to MOH ICT with the certificate lifecycle; key backup in the DR runbook (§7.7) | Medium |
| E14 | No plan for the initial load of a facility's existing data | Snapshot during onboarding, one facility at a time, verified by reconciliation (§5.10) | High |
| E15 | Sender and receiver upgraded out of order, or with conflicts pending | Follow the module's documented order: drain conflicts, upgrade the receiver, then each sender | Medium |

## 10. Before route one

Superseding the checklist in
[`integration/eip/routes/README.md`](../../integration/eip/routes/README.md):

1. **E1 settled by experiment.** Nothing else is worth building until the sender is known to
   stream from our database.
2. ADR 0005 accepted (identity): questions 1 and 2 in §8.
3. `openmrs-eip` **and** DB-sync versions pinned in `distribution/distro.properties`.
   Currently neither is; ADR 0006 removed `omod.eip` correctly but nothing replaced it.
4. Binlog enabled on the facility database, with a dedicated replication user, and binlog
   retention at the six-month floor (§1.3).
5. Artemis broker and sender management database added to the compose files (§1.2).
6. Client certificate mounted on the facility `sync` service; mTLS proven end to end over
   the broker connection (§1.4).
7. Route inventory reconciled against DB-sync's actual coverage (§1.6, E3).
8. Queue and retry retention policy configured (§5.8).
9. A sync assertion added to the upgrade rehearsal in `qa/upgrade/` (§1.3 accepts a schema
   coupling; this is what keeps that acceptable).
10. Broker permissions set send-only per facility, with the **negative test** asserting that
    a facility credential cannot read another facility's address or consume from the
    receiver queue (§7.3, E7).
11. Facility disk sized for the retention window, with binlog on its own volume and alarms
    configured (F2, E8).
12. Receiver-first start order enforced and tested: a sender started first must not lose
    messages (E11).
13. PGP payload encryption enabled, with key custody and rotation owned by MOH ICT (§7.7).
14. Initial-load procedure defined and rehearsed on the pilot data (§5.10, E14).
15. The §5.9 acceptance test written and passing. Until it passes, the offline guarantee is
    a claim rather than a property.

## 11. Related documents and sources

- [Module evaluation](sync-module-evaluation.md): options considered, justification, plan,
  expected outcomes and risks
- [Entity coverage and sync order](sync-entity-coverage.md): the 34 entities, dependency
  chain, and what needs custom work
- [ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md) · [ADR 0007](../adr/0007-pulled-record-scope.md)
  · [ADR 0008](../adr/0008-adopt-openmrs-dbsync.md)

### Sources

- [`openmrs/openmrs-eip`](https://github.com/openmrs/openmrs-eip): the EIP toolbox:
  `openmrs-watcher`, the OpenMRS Camel component, management datasource.
- [`mekomsolutions/openmrs-dbsync`](https://github.com/mekomsolutions/openmrs-dbsync): the
  sender and receiver applications, supported versions, Artemis guidance, binlog retention
  guidance and stated limitations.
- [Debezium connector for MariaDB](https://debezium.io/documentation/reference/stable/connectors/mariadb.html):
  MariaDB is served by its own connector rather than the MySQL one, which is what makes E1 a
  real question rather than a formality.
