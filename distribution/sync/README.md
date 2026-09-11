# Sync images (`liberia-emr-sync`, `liberia-emr-sync-receiver`)

Both sides of the unidirectional facility to central push: the dbsync sender (runs at
each facility) and the dbsync receiver (runs at central), from
[mekomsolutions/openmrs-dbsync](https://github.com/mekomsolutions/openmrs-dbsync) at the
tag pinned as `sync.dbsync` in `distribution/distro.properties`. One Dockerfile builds
both, selected with `--target sender` / `--target receiver`;
`scripts/build/build-distribution.sh` builds the pair. The design they implement is
[docs/architecture/sync-eip.md](../../docs/architecture/sync-eip.md); the route-level
contract is [integration/eip/routes/README.md](../../integration/eip/routes/README.md).

## Why they build from source

Stock dbsync 4.0.0 refuses to start against OpenMRS 2.8.x, and both ends of this
deployment run platform 2.8.8. `patches/0001-allow-openmrs-2.8.patch` widens the version
whitelist by one line; the patch header carries the justification and test evidence, and
`packages/modify-pr/.patches/` tracks the upstream PR
([mekomsolutions/openmrs-dbsync#12](https://github.com/mekomsolutions/openmrs-dbsync/pull/12))
that retires it. When it merges and releases, delete the patch and switch this
Dockerfile to the released `-exe.jar`s from Mekom's Nexus.

## What the sender needs (facility)

- The facility database with the **binary log enabled** (the facility compose sets it).
- A **replication-privileged Debezium user** and a **management schema**, created on the
  first boot of an empty database by
  `distribution/compose/facility/initdb/10-sync-db-users.sh`; on an existing database,
  run its statements by hand once.
- The broker at central, or, before it is reachable, a `file:` output endpoint
  (`SYNC_OUTPUT_ENDPOINT`), upstream's QA-only testing mode.
- The environment contract in `docker-entrypoint.sh`; the entrypoint refuses to start
  with anything missing.

## What the receiver needs (central)

- The Artemis broker (the `artemis` service in the central compose) and its
  credentials.
- A **management schema** on the central database, created on first boot by
  `distribution/compose/central/initdb/10-sync-mgmt-db.sh`; by hand on an existing
  database. It holds the inbound queues, the conflict queue, retries, and the
  per-entity hashes.
- The environment contract in `docker-entrypoint-receiver.sh`.
- Its broker subscription is **durable** under a fixed name and clientId: once it has
  connected successfully **once**, messages published while it is down wait on the
  broker. Until that first connection the subscription does not exist and the broker
  silently discards published messages (risk E11 in sync-eip.md, rated highest), so a
  fresh deploy brings the receiver up and confirms it subscribed before any facility
  sender is pointed at the broker. Never change the subscription name or clientId once
  set; the old subscription's backlog would strand.

## Durable state

`/opt/eip` must be a named volume on both sides. For the sender it is the Debezium
offset and schema history (losing it means re-snapshotting); for the receiver,
complex-obs staging. The queues live in each side's management schema, and the broker
journal holds in-flight messages; all of these are enumerated copies of clinical data
at rest (sync-eip.md section 7.4).

## Verifying (QA)

- `qa/sync/verify-sender-capture.sh`: facility-only check, registration to captured
  payload, no PHI in logs.
- `qa/sync/verify-e2e-push.sh`: the full chain, a patient registered at the facility
  appears at central with the same UUID intact. Acceptance criterion 1 of LE-35.
