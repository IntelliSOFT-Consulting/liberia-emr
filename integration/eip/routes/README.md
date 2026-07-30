# Facility → central sync routes

Apache Camel routes (OpenMRS EIP) that push clinical data from a facility instance to the
central instance. **Unidirectional** in this release: central never writes back.

## Status: placeholder

No routes are implemented. This directory holds the contract they must satisfy, so that
the first route written is written against agreed semantics rather than discovering them
in production.

## Route inventory (to build)

| Route | Source | Trigger | Notes |
| --- | --- | --- | --- |
| `patient-push` | `patient`, `person`, `patient_identifier` | debezium / OpenMRS event | Identity is the hard part — see below |
| `visit-push` | `visit` | event | Must arrive after its patient |
| `encounter-push` | `encounter`, `obs` | event | Ordered within a visit |
| `program-push` | `patient_program`, `patient_state` | event | MCH programme enrolments |
| `order-push` | `orders` | event | Lab and drug orders |

## Non-negotiable properties

**Durable local queue.** The queue survives a container restart and a multi-day outage.
Nothing is acknowledged upstream until central has confirmed receipt. `sync-queue` is a
named volume in `distribution/compose/facility/docker-compose.yml` for exactly this reason.

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
it in an ADR *before* the first production push. Until then central stores what it is sent
and flags candidate duplicates for human review.

## Before writing route one

1. ADR on identity reconciliation (above).
2. Confirm the EIP module version pinned in `distribution/distro.properties`.
3. Confirm the mutual-TLS setup with the MOH ICT Unit — the certificate lifecycle is
   theirs, not ours.
4. Decide the retention policy for the local queue after a successful push.
