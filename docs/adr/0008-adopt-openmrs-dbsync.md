# 0008: Adopt openmrs-eip + openmrs-dbsync over ActiveMQ Artemis for facility→central sync

**Status:** Proposed, conditional on the MariaDB spike (see Consequences)
**Date:** 18 August 2026 · **Ticket:** LE-22

## Context

The sync layer is the highest engineering risk in the programme (IMPLEMENTATION.md §3) and
nothing has been built: `distribution/` contains Dockerfiles for `backend`, `frontend` and
`gateway` only, and `build-distribution.sh` builds those three. The `sync` and
`sync-receiver` services in the compose files name images that nothing produces.

`distribution/distro.properties` records that `openmrs-eip` "is a standalone Camel
application, run as its own container, not an OMOD". That is correct about what EIP is not,
but it names the wrong artefact for pinning: **`openmrs-eip` is a toolbox**: the
`openmrs-watcher` Debezium engine, the OpenMRS Camel component, a Spring Boot launcher, and
is not a deployable sync application.

Seven options were evaluated in [the module evaluation](../architecture/sync-module-evaluation.md):
dbsync, a custom FHIR push, the legacy `sync` module, `sync2`, Atom Feed, native database
replication, and a hand-assembled Debezium/Kafka pipeline.

## Decision

Adopt **`mekomsolutions/openmrs-dbsync` 4.0.0** (the deployable sender and receiver
applications) on **`openmrs/openmrs-eip` 4.2.0**, with **ActiveMQ Artemis** as the JMS broker,
**PGP payload encryption**, and **mutual TLS** on the broker connection.

Both artefacts are pinned exactly in `distribution/distro.properties`, per ADR 0001. Neither
`4.1.0-SNAPSHOT` nor any other SNAPSHOT ships.

The stack has a national-scale production precedent: CSaúde runs OpenMRS EIP-based sync for
Mozambique's EMR programme across many low-connectivity facilities, on an actively maintained
fork and deployment configuration. Mekom's upstream is also alive, with retry fixes and the
4.x line landing in late 2025. We pin upstream, not the fork.

Rationale, in short; the long form is in the evaluation:

- A large part of the requirement is **already built and verified in source**: 34 mapped
  OpenMRS entities, durable retry queues, a conflict queue with modification-date comparison,
  per-entity hash tables, PGP payload encryption, Prometheus metrics, search-index maintenance
  at the receiver, and multi-site awareness. Rebuilding that is the whole of the custom-FHIR
  option, and the result would be less tested on day one.
- Change capture below the OpenMRS API matters for a national dataset: a correction applied
  in SQL is the change you most need to see, and an API-level feed (Atom) never emits it.
- Native database replication was rejected on security grounds: it copies credentials and
  facility-local state, and inverts the trust model.

**Transport is not a free choice.** dbsync publishes over JMS with Artemis documented and
assumed by its property templates. An earlier draft of the architecture specified HTTPS to
`EIP_CENTRAL_URL`, reasoning that two facilities and one consumer do not need a broker. That
reasoning was sound and inapplicable: choosing HTTP means replacing the sender's publish
route and rebuilding the delivery guarantee, which is the main reason to adopt the module.

**FHIR is not rejected; it is placed.** The push uses dbsync's native format (same-product
replication, where fidelity beats legibility, and where `patient_program`/`patient_state` has
no honest FHIR mapping). FHIR is adopted for every read path: cross-facility query, DHIS2
export, future national exchange.

**Identity is built at central for v1**, not delegated to a client registry (OpenCR, SanteMPI,
JeMPI), and kept behind a resolver boundary so one can be adopted later. `csaude/openmrs-module-mpi`
was examined and does not fit as-is: it assumes every patient has a National ID, and Liberia's
is optional at registration, which is the condition that makes our problem hard.

## Consequences

- **Two services must be added** to the compose files: an **Artemis broker** at central, and a
  **management database** for the sender (its retry state and Debezium offset live there, not
  in the OpenMRS database; the `sync` service today receives only OpenMRS credentials).
- **Start order becomes operationally significant.** dbsync requires the receiver to connect
  with a **durable topic subscription before any sender publishes**. A sender that publishes
  first loses messages. This is a deployment-runbook rule, not a preference.
- **We inherit a schema coupling.** The sender reads the physical OpenMRS schema, so a
  platform upgrade is a sync regression risk. The upgrade rehearsal in `qa/upgrade/` must grow
  a sync assertion before the second facility goes live.
- **Metadata must not diverge.** dbsync assumes metadata is centrally managed; we satisfy this
  because facility and central run the same backend image with the same `${var.*}` UUIDs
  (ADR 0003). Running different content-package versions at facility and central breaks sync.
- **The initial load of an existing facility database is a planned operation, not a free
  side effect.** Change capture only sees changes; pre-existing rows arrive only via a
  Debezium snapshot, which the watcher supports. Snapshot during onboarding, one facility at
  a time, verified by reconciliation (architecture §5.10).
- **`order-push` is at risk.** dbsync documents that sync of `Order` subclasses (`TestOrder`,
  `DrugOrder`, `ReferralOrder`) fails. The models exist, so this is a defect rather than
  missing support, but lab and pharmacy scope depends on the outcome.
- **PGP key management becomes an MOH ICT responsibility**, alongside the certificate
  lifecycle. Payload encryption is only a control if someone owns the keys.
- **Central must be read-only for clinical data.** dbsync states the receiver is not a
  point-of-care system because of conflict-overwrite risk. Enforce with roles at central, not
  convention.

### This decision is conditional

`openmrs-watcher` 4.2.0 depends on **`camel-debezium-mysql-starter`**, which resolves to
**Debezium 2.4.0.Final**: the **MySQL** connector, at a version predating official MariaDB
support (Debezium's dedicated MariaDB connector arrived in 2.7). Both compose files run
**MariaDB 10.11**, against a documented support envelope of **MySQL 5.7.x/8.0.x**.

**A spike must confirm the sender attaches and streams from MariaDB 10.11 before Sprint 3
commits.** If it does not, this ADR stands unchanged with **MySQL 8.0** substituted in both
compose files. That substitution costs almost nothing today, because nothing is built and no
facility is live; after go-live it is a database migration with clinical data in it.

The documented platform range (2.5/2.6) also sits below our 2.8.8 pin. The range predates the
4.x line and is likely stale, but it is settled by a schema diff across the 34 synced tables,
not by argument. Pinning the platform back is **not** an acceptable resolution, because it would undo
[ADR 0006](0006-pin-o3-refapp-3.7.1.md).
