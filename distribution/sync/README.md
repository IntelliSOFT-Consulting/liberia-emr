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
- The broker at central as `ARTEMIS_URL=ssl://<central>:61617`, where the host is one of
  the names in the broker certificate. Plain `tcp://` and URL options are refused. Before
  central is reachable, a `file:` output endpoint (`SYNC_OUTPUT_ENDPOINT`) is upstream's
  QA-only testing mode.
- This facility's security material mounted at `/app/sync-certs`: `client.p12`,
  `truststore.p12` and their `.pass` files, and `pgp/` holding its own `*-sec.asc` plus the
  receiver's `*-pub.asc`, with `pgp.pass`. The sender publishes only to its own address,
  `sync.facility.<FACILITY_CODE>`.
- The environment contract in `docker-entrypoint.sh`; the entrypoint refuses to start
  with anything missing.

## What the receiver needs (central)

- The broker (the `artemis` service in the central compose, `distribution/broker/`).
- Its security material mounted at `/app/sync-certs`: `client.p12`, `truststore.p12` and
  their `.pass` files, and `pgp/` holding its own `*-sec.asc` plus every enrolled
  facility's `*-pub.asc`, with `pgp.pass`. A facility enrolled on the broker but missing
  from `pgp/` has every message rejected at signature verification.
- A **management schema** on the central database, created on first boot by
  `distribution/compose/central/initdb/10-sync-mgmt-db.sh`; by hand on an existing
  database. It holds the inbound queues, the conflict queue, retries, and the
  per-entity hashes.
- The environment contract in `docker-entrypoint-receiver.sh`.
- A sync account (`SYNC_REST_USER`) with the `Sync Receiver` role only, and for the sender
  one with `Sync Sender` (docs/runbooks/sync-operations.md section 6).
- Its subscription queue, `DB-SYNC-REC.DB-SYNC-RECEIVER`, is declared by the broker, so
  messages wait there from the broker's first start, whether or not the receiver has
  connected (risk E11). Never change the clientId or subscription name in the receiver
  template without changing the broker enrolment to match.

## Security

Both apps run as uid 999 and connect over mutual TLS with a client certificate and no
broker password; the mounted material must be readable by that uid. The entrypoints pass
the keystore settings to Java through an argument file written with umask 077, so store
passwords never reach the process arguments. Payloads are PGP-signed
by the facility and encrypted to the receiver; neither side starts with encryption turned
off for the broker. Material shapes and a development issuer are in
`scripts/security/gen-sync-certs.sh`; production material comes from the MOH ICT Unit.

Open gap (sync-eip.md 7.2): dbsync binds each message to the facility key named in its
sender header, but it takes the facility code inside the payload as sent and has no setting to
compare the two, so an enrolled facility could still attribute records to another site. It is
recorded against control D2 in the security register.

The receiver is configured, within what dbsync offers, to:

- acknowledge each message on its own (`acknowledgementMode=4`, ActiveMQ's individual
  acknowledge). With upstream's client acknowledge, a message the receiver failed on was
  acknowledged along with the next one it applied while shutting down, so it was lost instead
  of redelivered and dead-lettered;
- never reply to a message (`disableReplyTo`), since `JMSReplyTo` is set by the sender;
- log its retry route and complex obs processor at WARN, because at INFO they write clinical
  payloads. dbsync still quotes part of a payload in a JSON mapping error, and at DEBUG it logs
  every payload, so central never runs with `SYNC_LOG_LEVEL=DEBUG` outside a test stack.

One consequence of the JVM-wide truststore: it replaces Java's default CA list inside the
sync containers. That is fine while `OPENMRS_BASE_URL` is the internal http address; an
https address signed by a public CA would stop verifying.

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
- `qa/sync/outage-drill.sh`: acceptance criterion 2. Cuts the broker link, registers a
  counted batch through the outage including container restarts, restores the link, and
  asserts every record lands at central exactly once with empty retry queues. Also
  asserts the binlog retention floor (risk F1), the one thing time compression cannot
  exercise.
- `qa/sync/verify-hardening.sh`: the broker's refusals, from real certificates over
  OpenWire (the apps' protocol): other facilities' addresses, the topic, subscriptions,
  missing, foreign and revoked certificates, wrong host names, removed enrolment, the
  admin certificate on the facility port, messages kept before the receiver connects, and
  unacknowledged messages kept in the dead-letter queue, replayable and exportable by
  facility. Also runs payloads through dbsync's own PGP services, including a sender header
  naming another facility. Runs in CI on every change to the sync security surface.
- `qa/sync/verify-receiver-failure.sh`: against a running central, a message the receiver
  cannot apply is redelivered and dead-lettered rather than lost, while messages behind it
  apply and their reply requests are ignored.
- `qa/sync/verify-conflict-resolution.sh`: a real conflict resolved with dbsync's procedure;
  the alert clears, the facility's next change applies, and no payload reaches the log.
- `qa/sync/verify-alert-delivery.sh`: alerts arrive by email over STARTTLS and by webhook.
  Runs in CI.
- `qa/sync/verify-alerting.sh`: acceptance criterion 3. Provokes a real push failure,
  asserts the SyncPushErrors alert fires and is admin visible, and that it resolves on
  recovery (resolution rides the sender's 30 minute retry cycle).
