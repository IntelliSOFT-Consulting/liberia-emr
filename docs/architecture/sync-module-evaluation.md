# Sync layer: module evaluation and selection

**Status:** Research complete, recommendation proposed, for review by Paul (IntelliSOFT) and
the MOH ICT Unit.
**Date:** 18 August 2026 · **Ticket:** LE-22 · **Decision recorded in:** [ADR 0008](../adr/0008-adopt-openmrs-dbsync.md)

This is the evidence behind the sync design. It records what was evaluated, what was chosen,
what was rejected and why, and (most importantly) **what was verified against source code
rather than taken from prose**, because the two disagree in places that matter.

Companion documents: [Sync & EIP architecture](sync-eip.md) (the strategy),
[Entity coverage and sync order](sync-entity-coverage.md) (what actually syncs).

---

## 1. What the requirement actually is

From the programme documents, not invented here:

| Requirement | Source |
| --- | --- |
| Each facility runs a **complete** EMR and keeps working with no link | `docs/architecture/README.md` |
| Facility → central push; central never writes back this release | `integration/README.md` |
| Queue survives restart and multi-day outage, drains in order | `integration/eip/routes/README.md` |
| Idempotent replay; a half-successful push must converge | same |
| Sync must never block care | same |
| No PHI in logs | same |
| mTLS on every facility↔central hop | same |
| Cross-facility query later, as a **read** path | `integration/cross-facility/README.md` |

Two properties of the deployment shape everything: **connectivity is poor and intermittent**,
and **facility servers sit in health centres, not a data centre**. The design target is
therefore not "sync quickly" but *lose nothing across an arbitrarily long outage, reconcile
completely when the link returns, and never make a clinician wait for either.*

---

## 2. Options evaluated

### 2.1 Summary

| # | Option | Verdict |
| --- | --- | --- |
| A | **openmrs-eip + openmrs-dbsync** (Debezium CDC → JMS → receiver) | **Recommended** |
| B | Custom FHIR push (our own Camel routes over FHIR resources) | Rejected: rebuilds a mature product, badly |
| C | OpenMRS `sync` module (1.x legacy) | Rejected: not available for O3 / platform 2.x |
| D | `sync2` module | Rejected: effectively unmaintained; Atom-feed model unfit for our volume |
| E | Atom Feed module + custom consumer | Rejected: API-level feed misses non-API writes; no delivery guarantees |
| F | Database replication (MariaDB/MySQL native) | Rejected: replicates *everything*, wrong trust and filtering model |
| G | Third-party ETL (Debezium + Kafka, or similar, hand-assembled) | Rejected for v1: all the cost of A with none of the OpenMRS domain logic |
| H | SymmetricDS (trigger-based DB replication) | Rejected: puts triggers on every clinical table and knows nothing of OpenMRS semantics |
| I | Integration engine (Mirth Connect, OpenHIM) | Rejected for the push: message-level tools need an API-level feed, inheriting Option E's blindness |

### 2.2 Why A wins, concretely

Option A is not "the OpenMRS way" as an argument from authority. It wins because a very
large amount of the work in §1 is **already built and battle-tested**, and every one of the
following was verified in source, not inferred:

| Requirement | Already provided by dbsync |
| --- | --- |
| Change capture below the API | Debezium engine over the binlog (`openmrs-watcher`) |
| 34 OpenMRS entities modelled and mapped | `TableToSyncEnum`: see [entity coverage](sync-entity-coverage.md) |
| Durable retry | `sender_retry_queue`, `ReceiverRetryQueueItem` |
| Conflict detection | `ConflictQueueItem` / `receiver_conflict_queue`, with modification-date comparison |
| Change detection / dedup | Per-entity hash tables (`*Hash`, `HashBatchUpdater`) |
| Multi-facility identity | `SiteInfo` entity in receiver management |
| **Payload encryption independent of TLS** | `SenderEncryptionProperties` / `ReceiverEncryptionProperties` (PGP-style: key folder, user id, passphrase, receiver user id) |
| Operational metrics | `ReceiverPrometheusConfig`: Prometheus endpoint |
| Search index consistency at central | `SearchIndexUpdateTask`, `FullIndexerTask` |
| Queue hygiene | `CleanerTask`, archiving of synced messages |
| Complex obs (attachments) | `ComplexObsProcessor`, `ComplexObsHash` |

Rebuilding that list is the entirety of Option B. The estimate for doing it *properly*,
with conflict handling, hashing, encryption and metrics, is far beyond LE-22's 3-day design
LOE and beyond Sprint 3's implementation budget, and the result would be less tested on day
one than dbsync is today.

### 2.3 Why the alternatives fail

**B, custom FHIR push.** Attractive because FHIR is the MOH-legible standard and we want it
anyway. It fails on fidelity and cost. `patient_program` / `patient_state`: MCH programme
enrolment, which is *core* Sprint 2/3 scope, has no honest FHIR mapping (`EpisodeOfCare` is
a stretch and loses the workflow/state model). We would be writing a bespoke delivery
guarantee for a national clinical dataset, which is the highest-risk code in the programme
and the least justified. **FHIR is still adopted, for the read paths (§2.4).**

**C, the legacy `sync` module.** Built for the 1.x platform and the legacy UI; not a candidate
for a platform 2.8 / O3 distribution.

**D, `sync2`.** Intended successor to C, never reached maturity, no active maintenance to
depend on for a multi-year MOH engagement. Adopting an unmaintained module for the highest-risk
component contradicts the sustainability commitment in `README.md`.

**E, Atom Feed.** The decisive flaw: it publishes what passes through the OpenMRS **API**.
A correction applied by a support engineer in SQL, or anything written outside the API, never
appears. For a national dataset those are the changes you most need to see. It also
provides no durable delivery guarantee; the consumer must build one.

**F, native DB replication.** Replicates the whole schema including users, password hashes
and facility-local settings, gives no filtering, and makes central a mirror rather than an
aggregate. It also inverts the trust model: a compromised facility could write anything into
central. Rejected on security grounds alone.

**G, hand-assembled Debezium plus Kafka.** This is Option A with the OpenMRS domain layer
removed and a broker upgrade added. Every entity mapping, conflict rule and hash would be
ours to write. Kafka is also a heavier operational commitment than a two-facility deployment
justifies. Revisit only if facility count reaches a scale where Artemis is the bottleneck.

**H, SymmetricDS.** A mature general-purpose database replicator, used in other health
projects. It is trigger-based: every replicated table gains insert/update/delete triggers,
which adds write overhead inside the clinical transaction path that binlog capture
deliberately avoids, and its conflict handling is generic row-level logic with no notion of
OpenMRS voiding, UUIDs or the visit/encounter hierarchy. Choosing it means re-solving the
domain problems dbsync has already solved, on a foundation that taxes the facility database.

**I, integration engines (Mirth Connect, OpenHIM).** Excellent tools in their place, but
their place is message transformation and routing between systems that already emit events.
OpenMRS does not emit a complete event stream at the API level, which is Option E's flaw
again. OpenHIM in particular belongs in the *future* of this architecture rather than the
present: if the MOH later builds a national OpenHIE exchange, OpenHIM mediates the FHIR read
paths, and nothing in this design blocks that.

### 2.4 Production precedent

This stack is not a paper choice. CSaúde runs OpenMRS EIP-based sync for Mozambique's
national EMR programme, maintaining its own fork of `openmrs-eip` and an actively updated
Docker deployment (last pushed February 2026). That is the closest existing deployment to
our shape: many low-connectivity facilities pushing to a centre, on the same toolbox.
Upstream is alive too: Mekom committed retry-handling fixes to dbsync in late 2025 and
bumped it to the 4.x line against eip 4.2.0. We pin the Mekom upstream rather than the
CSaúde fork, because the fork tracks Mozambique's needs and its dbsync variant has not
moved since 2022; the precedent matters, not the artefact.

### 2.5 Where FHIR *is* adopted

Rejecting B does not reject FHIR. The split is deliberate:

- **Push (facility → central): dbsync's native format.** Same-product replication, where
  fidelity beats legibility and the module owns the contract.
- **Read paths: FHIR.** Cross-facility query (Sprint 4), DHIS2 export, and any future
  national exchange. These cross a product boundary, where the standard earns its cost and
  where nothing constrains our choice.

Resources in scope for the read paths, all served by the OpenMRS FHIR2 module: `Patient`,
`RelatedPerson`, `Encounter`, `Observation`, `Condition`, `AllergyIntolerance`,
`MedicationRequest`, `ServiceRequest`, `DiagnosticReport`, `Immunization`, `Location`,
`Practitioner`. Profiles live in `integration/fhir/` and bind to CIEL concepts via `${var.*}`.

---

## 3. Identity: build in central, or adopt a client registry?

The identity problem is separable from the transport problem, and it has its own market.

| Option | What it is | Verdict |
| --- | --- | --- |
| **I1: Identity layer inside central** | CPI + link table + matching, built by us at central | **Recommended for v1** |
| I2: OpenCR | OpenHIE reference client registry, FHIR-native, HAPI-backed | Strong v2 candidate |
| I3: SanteMPI | Mature national-scale MPI; documented OpenMRS integration; offline-capable | Strong v2 candidate |
| I4: JeMPI (Jembi) | Standards-based MPI, deterministic + probabilistic, batch and transactional | Credible; heaviest |
| I5: `csaude/openmrs-module-mpi` | OpenMRS module pushing patients to OpenCR/SanteMPI via Debezium | Useful precedent, **wrong fit as-is** |

**Why I1 for v1.** Two facilities, one central instance, and a matching policy that is not
yet agreed (ADR 0005 is still Proposed). Adopting a full MPI now means deploying and
operating another national-scale service, with its own database, backup, security review and
MOH training burden, in order to serve two sites, before the policy it would enforce has
been signed off. The identity layer we need for v1 is a CPI, a link table and a review
queue; that is a bounded piece of work at central, and it is the same data model an MPI would
later consume.

**Why I5 does not fit as-is, and this is the instructive one.** `csaude/openmrs-module-mpi`
solves nearly our problem (Debezium-driven patient push into OpenCR/SanteMPI) but its
documentation states it *assumes every patient has been assigned a National ID*, and its
OpenCR matching is NID-first deterministic. **Liberia's National ID is optional at
registration** (`Required=false` in `patientidentifiertypes.csv`), which is the
condition that makes our problem hard. The module's core assumption is the assumption we
cannot make.

**Migration path, so v1 is not a dead end.** Keep the identity layer behind a boundary:
central owns "resolve these demographics to a CPI", and nothing else depends on *how* it is
resolved. If the MOH later adopts a national client registry, that resolver is repointed at
OpenCR or SanteMPI and the link table becomes the local cache of its decisions. This is
recorded as a consequence in ADR 0005 so the option is not quietly lost.

---

## 4. Versions: what to pin

Neither component is pinned anywhere in the distribution today. Both must be, as their own
artefacts, per ADR 0001's exact-pin discipline.

| Component | Latest release | Notes |
| --- | --- | --- |
| `mekomsolutions/openmrs-dbsync` | **4.0.0** | master is `4.1.0-SNAPSHOT`: do not ship a SNAPSHOT |
| `openmrs/openmrs-eip` | **4.2.0** | the version dbsync 4.0.0 depends on (`eipVersion`) |
| Apache Camel | 4.1.0 | transitive, via eip 4.2.0 |
| Java | 17 | matches our toolchain ✅ |

The 3.x line (dbsync 3.0.3 → eip 3.2.0, Camel 3.3.0, Java 8) is **not** a candidate: Java 8
conflicts with our JDK 17 toolchain.

---

## 5. Compatibility: where we sit outside the envelope

The most important output of this evaluation. Verified against both documentation and
the dependency tree.

| | Documented / shipped | LiberiaEMR | Status |
| --- | --- | --- | --- |
| OpenMRS platform | README says **2.5 or 2.6** | **2.8.8** | ⚠ Outside |
| Database | **MySQL 5.7.x / 8.0.x** | **MariaDB 10.11** | ⚠ Outside |
| Java | 17 | 17 | ✅ |
| Directionality | one-way | one-way | ✅ |
| Timezone | sender and receiver must match | both `Africa/Monrovia` | ✅ |

### 5.1 The MariaDB question, stated plainly

This is the highest-severity finding and it is now evidence-based rather than a documentation
gap:

- `openmrs-eip` 4.2.0's `openmrs-watcher` depends on **`camel-debezium-mysql-starter`**
  via Camel 4.1.0, which resolves to **Debezium 2.4.0.Final**.
- That is the Debezium **MySQL** connector, at a version that predates official MariaDB
  support. Debezium introduced its **dedicated MariaDB connector in 2.7**; at 2.4 there is
  no MariaDB connector anywhere in the dependency tree and no documented MariaDB
  compatibility for the MySQL one.
- The upstream fix, if the spike fails and we still want MariaDB, would be a Camel and
  Debezium bump inside `openmrs-eip` itself. That is real work with its own regression
  surface, which is why switching to MySQL 8.0 is the cheaper resolution today.

So MariaDB 10.11 would be served, if at all, by a connector that is not built for it, in a
line Debezium is moving away from. "MariaDB is a drop-in for MySQL" is broadly true at the
SQL layer and **not** a safe assumption at the binlog/replication-protocol layer, which is
the layer we depend on.

**This must be settled by experiment before Sprint 3 commits.** See §7.

### 5.2 The platform-version question

The README's "2.5 or 2.6" predates the 4.x line (which is Camel 4 / Java 17 and clearly
modern), so it is likely stale rather than a hard ceiling. But the sender reads the
**physical schema**, so the real question is narrow and answerable: *do any of the 34 synced
tables differ between 2.6 and 2.8.8?* That is a schema diff plus a test run, not a debate.

### 5.3 The metadata assumption, and why we already satisfy it

dbsync states that it syncs patient and clinical data *"assuming metadata is already
centrally managed using the available metadata sharing tools."* ADR 0006 **dropped
`metadatasharing`** from the distribution.

This is not a gap; we satisfy the precondition by a better mechanism. Metadata is managed by
our **content packages via Initializer**, with every UUID declared once in
`variables.properties` and referenced as `${var.*}` (ADR 0003). Facility and central run the
**same** `liberia-emr-backend` image and therefore the same metadata with the same UUIDs.
That is a stronger guarantee than metadata sharing provides, because it is built into the
image rather than applied by an operator.

**It does impose a rule:** facility and central must never run different content-package
versions across an upgrade boundary. A concept UUID that exists at a facility but not at
central is a sync failure. This belongs in the deployment runbook and in the upgrade
rehearsal.

---

## 6. What we get, what we configure, what we must build

| Concern | dbsync provides | We must do |
| --- | --- | --- |
| Change capture | ✅ Debezium | Enable binlog; dedicated replication user |
| Entity coverage | ✅ 34 entities | Reconcile against our 5 routes ([coverage](sync-entity-coverage.md)) |
| Transport | ✅ JMS | **Add an Artemis broker**: absent from compose |
| Sender state | ✅ management DB | **Add a management database**: absent from compose |
| Retry | ✅ retry queues | Configure policy; alerting |
| Conflicts | ✅ conflict queue | Define who resolves them, and their SLA |
| Encryption | ✅ PGP payload encryption | Key generation, distribution, rotation: an MOH ICT process |
| Metrics | ✅ Prometheus | Wire to monitoring; define alerts |
| App upgrades | ✅ documented procedure | Runbook: drain the conflict queue, upgrade the receiver first, then each sender |
| mTLS | ➖ broker-level | Configure; **mount facility client certs**: absent |
| **Identity / CPI** | ❌ | **Build at central**: §3 |
| **Cross-facility query** | ❌ | **Build (Sprint 4)**: FHIR read path |
| **Reconciliation reporting** | ◐ hashes exist | Build the periodic parity report on top |
| Facility disk sizing | ❌ | Hardware spec: a clinical-safety item, see [architecture](sync-eip.md) §5.9 |

---

## 7. Plan, expected outcomes, and what could go wrong

### 7.1 Sequence

| Step | Work | Expected outcome | If it fails |
| --- | --- | --- | --- |
| **0** | **MariaDB/Debezium spike** (§5.1): binlog on, dbsync 4.0.0 sender against our stack | Sender attaches and streams row events | Switch both compose files to MySQL 8.0: cheap now, a data migration after go-live |
| 1 | Schema diff, 2.6 → 2.8.8, across the 34 synced tables | No material differences, or a short known list | Budget upstream compatibility work; do **not** pin the platform back (undoes ADR 0006) |
| 2 | Pin dbsync 4.0.0 + eip 4.2.0; build `sync` / `sync-receiver` images | Images exist and are versioned (today they are named but never built |) |
| 3 | Add Artemis broker + sender management DB to compose | Stack starts; receiver subscribes **before** any sender publishes |: |
| 4 | mTLS + PGP keys, end to end | Facility authenticates; payloads encrypted at rest in transit | Certificate lifecycle is MOH ICT's: escalate early |
| 5 | Entity/route reconciliation | Confirmed list of covered vs custom routes | Defer `order-push` if the subclass defect stands |
| 6 | Identity layer (CPI + link + review queue) at central | Duplicates surfaced, never auto-merged | Blocked on ADR 0005 sign-off |
| 7 | **Offline acceptance test** ([architecture](sync-eip.md) §5.9) | Full drain and zero divergence after a long outage | The guarantee is unproven until this passes |
| 8 | Cross-facility query (Sprint 4) | Read path over FHIR, scoped per ADR 0007 | Blocked on ADR 0007 sign-off |

### 7.2 Expected outcomes

- Facilities sync every patient and clinical change to central with **at-least-once delivery
  and idempotent upsert**, surviving outages bounded only by binlog retention and disk.
- Central holds an aggregate national dataset with **duplicates surfaced rather than merged**.
- Clinicians are **never** blocked, delayed or alerted by sync.
- The whole thing is reproducible for facility three onward as configuration, not a fork.

### 7.3 Principal risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | MariaDB unsupported by the shipped connector | **Highest** | Step 0 spike before anything is built |
| R2 | Facility disk filled by binlog → **database stops → care stops** | **Highest** | Size for full retention; separate volume; alarms |
| R3 | Broker permissions let one facility read another's data | **Highest** | Send-only per facility, proven by negative test |
| R4 | **Receiver not subscribed before a sender publishes → messages lost** | High | Durable topic subscription; enforce receiver-first start order |
| R5 | Platform 2.8.8 schema drift | High | Step 1 schema diff |
| R6 | `Order` subclass sync defect | High | Reconcile; consider deferring `order-push` |
| R7 | Unstaffed conflict / duplicate review queues | High | Named MOH owner with an SLA: ADR 0005 |
| R8 | Content-package drift between facility and central | Medium | Same image; enforce in upgrade rehearsal |
| R9 | PGP key management burden falls on nobody | Medium | Assign to MOH ICT with the certificate lifecycle |
| R10 | Facility server theft | Medium | Full-disk encryption; central-side revocation |

---

## 8. Recommendation

Adopt **openmrs-eip 4.2.0 + openmrs-dbsync 4.0.0 over ActiveMQ Artemis**, with PGP payload
encryption and mutual TLS, and build the identity layer at central behind a resolver boundary
that a national client registry can later occupy.

**Conditional on Step 0.** If the MariaDB spike fails, the same recommendation stands with
MySQL 8.0 substituted for MariaDB 10.11 in both compose files, a change that is nearly free
today and expensive after a facility is live.

Recorded as [ADR 0008](../adr/0008-adopt-openmrs-dbsync.md).

---

## 9. Sources

Documentation and source code, retrieved 18 August 2026:

- [`openmrs/openmrs-eip`](https://github.com/openmrs/openmrs-eip): toolbox; `openmrs-watcher`;
  tags to 4.2.0; `camel-debezium-mysql-starter` dependency
- [`mekomsolutions/openmrs-dbsync`](https://github.com/mekomsolutions/openmrs-dbsync): sender
  and receiver apps; README (versions, Artemis, durable topic, conflict queue, limitations);
  `TableToSyncEnum` (34 entities); encryption, Prometheus, hash and queue classes; tags to 4.0.0
- [Debezium connector for MariaDB](https://debezium.io/documentation/reference/stable/connectors/mariadb.html)
  (MariaDB served by a dedicated connector, not the MySQL one)
- [`csaude/openmrs-module-mpi`](https://github.com/csaude/openmrs-module-mpi): OpenCR/SanteMPI
  integration; NID-first assumption
- [`csaude/openmrs-eip`](https://github.com/csaude/openmrs-eip) and
  [`csaude/openmrs-eip-docker`](https://github.com/csaude/openmrs-eip-docker): Mozambique's
  production fork and deployment configuration
- Maven Central: `camel-debezium-parent` 4.1.0 resolving `debezium-version` 2.4.0.Final
- [JeMPI](https://github.com/jembi/JeMPI), [SanteMPI](https://help.santesuite.org/product-overview/santesuite-products/master-patient-index-santempi),
  [OpenHIE Client Registry spec](https://guides.ohie.org/arch-spec/openhie-component-specifications-1/client-registry)
