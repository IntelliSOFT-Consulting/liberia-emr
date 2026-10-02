# Facility → central sync routes

Apache Camel routes (OpenMRS EIP) that push clinical data from a facility instance to the
central instance. **Unidirectional** in this release: central never writes back.

## Status: sender and receiver built

The routes themselves are dbsync's own (ADR 0008): we deploy and configure them rather
than write them. The facility-side sender ships as the `liberia-emr-sync` image and the
central side as `liberia-emr-sync-receiver`, both built in
[`distribution/sync/`](../../../distribution/sync/) from the pinned dbsync tag. The
sender sits in the facility compose behind `--profile sync`; the Artemis broker and the
receiver are ordinary services in the central compose. Reconciliation is built for existence
([sync-eip.md](../../../docs/architecture/sync-eip.md) §5.5); comparing content is still to
build. This directory remains the contract that deployment and configuration must satisfy.

The design these routes implement (change capture, transport, wire format, retry and
reconciliation) is in [`docs/architecture/sync-eip.md`](../../../docs/architecture/sync-eip.md).
This file remains the route-level contract.

## Route inventory

All five are enabled, and `qa/sync/verify-e2e-push.sh` pushes one record through each from a
facility to central and checks it arrives intact.

| Route | Source | Trigger | Notes |
| --- | --- | --- | --- |
| `patient-push` | `patient`, `person`, `patient_identifier` | debezium / OpenMRS event | Identity is the hard part — see below |
| `visit-push` | `visit` | event | Must arrive after its patient |
| `encounter-push` | `encounter`, `obs` | event | Ordered within a visit |
| `program-push` | `patient_program`, `patient_state` | event | MCH programme enrolments |
| `order-push` | `orders` | event | Lab and drug orders. dbsync's README records `Order` subclass sync as failing (EIP-142); on 4.0.0 `TestOrder` and `DrugOrder` arrive as their subclass and the check holds them to it. `ReferralOrder` is unverified, since REST cannot create one |

**All five routes are covered by existing entity support**: `TableToSyncEnum` in dbsync
maps 34 OpenMRS entities spanning every one of them, so no custom entity development was
required. The set the sender watches is declared in
`distribution/sync/application.properties.template` (`eip.watchedTables`). Full mapping and
the dependency chain: [entity coverage](../../../docs/architecture/sync-entity-coverage.md).

Note also that these are **not** five independently scheduled routes: dbsync streams whatever
changes the binlog emits, in commit order. The table describes coverage, not a pipeline we
build one route at a time.

## Non-negotiable properties

**Durable local queue.** The sender's queues survive a container restart and a multi-day
outage: they live in its management schema, and its Debezium offset in the `sync-queue` named
volume (`/opt/eip` in `distribution/compose/facility/docker-compose.yml`), so a restarted
sender resumes where it stopped. An event leaves the facility's queue once the sender has
published it, or moves to the retry queue if publishing fails; from then on the broker at
central holds it in the receiver's durable subscription until it is applied
([sync-eip.md](../../../docs/architecture/sync-eip.md) §1.5, §5.8).

**Ordering within a patient.** A visit cannot land before the patient it belongs to. Global
ordering across patients is not required; ordering within one is.

**Idempotent replay.** Every message carries a stable natural key (the OpenMRS UUID) and
central upserts on it. A retry after a half-successful push must converge, not duplicate.

**Never blocks care.** If central is unreachable the facility keeps admitting, examining
and prescribing. Sync failure is an operational alert, never a clinical one.

**No PHI in logs.** Log the UUID and the outcome. Not the name, not the identifier, not the
observation value.

## Identity reconciliation

Two facilities will register the same person independently — someone attends Careysburg and
later Barnersville. There is no shared identifier at registration time, so central will
hold duplicates.

This is a **clinical safety decision, not a data-quality one**: silently auto-merging two
records can attach one person's obstetric history to another. Decide the policy and record
it in an ADR *before* the first production push.

The policy is
[ADR 0005: link, never merge](../../../docs/adr/0005-cross-facility-identity-reconciliation.md),
accepted by MOH ICT (LE-22) and built at central as the CPI service
([sync-eip.md](../../../docs/architecture/sync-eip.md) §2.5): central stores what it is sent,
links on an exact National ID match that passes the sex and date-of-birth check, and sends
failing matches to review. The review queue's named MOH owner is still open.

## Before writing route one

Superseded by [`docs/architecture/sync-eip.md`](../../../docs/architecture/sync-eip.md) §10,
and by [ADR 0008](../../../docs/adr/0008-adopt-openmrs-dbsync.md).

The design work established that the deployable sender and receiver are
[`mekomsolutions/openmrs-dbsync`](https://github.com/mekomsolutions/openmrs-dbsync) **4.0.0**
on `openmrs-eip` **4.2.0** (`openmrs-eip` alone is a toolbox, not a sync application), that
its transport is JMS via ActiveMQ Artemis, and that our MariaDB 10.11 and platform 2.8.8 pins
both sit outside its documented support envelope.

**Prove Debezium streams from our database before writing any route.** DONE 2026-09-02:
it does. The sender attached to MariaDB 10.11 and streamed a live registration; the
platform 2.8.8 version gate it hit, and the one-line patch that clears it, are recorded
in [sync-eip.md](../../../docs/architecture/sync-eip.md) §1.8 and
[`distribution/sync/patches/`](../../../distribution/sync/patches/).

1. ~~ADR 0005 accepted (identity, above).~~ Accepted; its review-queue owner is still open.
2. ~~Confirm the EIP module version pinned in `distribution/distro.properties`.~~ Pinned:
   `sync.dbsync=4.0.0`, `sync.eip=4.2.0`.
3. Confirm the mutual-TLS setup with the MOH ICT Unit — the certificate lifecycle is
   theirs, not ours.
4. ~~Decide the retention policy for the local queue after a successful push.~~ Settled by
   dbsync: both ends delete a message once it is processed and keep no archive
   ([sync-eip.md](../../../docs/architecture/sync-eip.md) §5.8).
