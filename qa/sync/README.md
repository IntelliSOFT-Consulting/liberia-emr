# Sync checks and drills

Checks for the facility→central push (dbsync sender → Artemis broker → receiver). The design
is in [sync-eip.md](../../docs/architecture/sync-eip.md), the images in
[distribution/sync/](../../distribution/sync/README.md) and
[distribution/broker/](../../distribution/broker/README.md), and the operator procedures
these rehearse in [sync-operations.md](../../docs/runbooks/sync-operations.md).

Every script prints its usage in its header comment and exits non-zero on the first failed
assertion.

## Run in CI

The `sync-hardening` job in `ci.yml` runs these, only when the commit touches
`distribution/{sync,broker,monitoring,compose,env}/`, `distribution/distro.properties`,
`scripts/{security,sync}/`, `qa/sync/` or `ci.yml` itself (the `changes` job; an
undetermined base runs it). The CI gate accepts it being skipped. `release.yml` runs none of
them.

| Script | Asserts | Needs |
| --- | --- | --- |
| `verify-compose-wiring.sh` | Rendered from the env examples: certificate mounts are read-only and must exist on the host, the broker publishes only 61617 on `ARTEMIS_BIND_ADDR`, and no stack defaults payload encryption off | docker, python3 |
| `verify-hardening.sh --broker-image … --sender-image … --exporter-image … [--jdk-image …] [--keep]` | The broker refusal suite (sync-eip.md 7.2, 7.3, 7.7; SOP D1, D2, D6, D8; risks E7, E11), over OpenWire with real certificates: no plain listener; a facility cannot send to another facility's address or the topic, or consume or subscribe; missing, foreign-CA and revoked certificates and wrong host names are refused; the admin certificate cannot use the facility port; TLS 1.1 is refused; a removed facility is refused; messages wait for an absent receiver; an unacknowledged message is dead-lettered after 10 attempts, replayable and exportable per facility; a new revocation list restarts the broker and takes effect, a foreign one is refused; PGP sign/verify through dbsync's own services, rejecting a header that names another facility | docker, openssl, keytool, gpg. Self-contained: throwaway material from `scripts/security/gen-sync-certs.sh` |
| `verify-alert-delivery.sh [--alertmanager-image …] [--mailpit-image …] [--python-image …]` | An alert raised in Alertmanager (the entrypoint both stacks use) reaches every email recipient over STARTTLS with login, and a webhook; the entrypoint refuses an incomplete or unsafe email configuration | docker, openssl, python3 |

The same job also builds the broker, sender, receiver and expiry-exporter images, checks the
sender and receiver refuse weaker configurations, checks both configuration templates, runs
`promtool` on the central alert rules and reads an issued certificate with the expiry
exporter. Those steps are inline in `ci.yml`, not scripts here.

`verify-hardening.sh` compiles the Java probes in `probes/` against the libraries inside the
sender image: `OpenWireProbe.java` (send, signed send, consume, subscribe, abandon over
OpenWire) and `PgpRoundTrip.java` (dbsync's PGP services, sender to receiver).

## Run against live stacks

Not run in CI. They need a running facility stack started with `--profile sync`, a central
stack, or both. To point them at a staging pair, override the connection flags:

| Flag | Default | Accepted by |
| --- | --- | --- |
| `--facility-url` | `https://localhost` | all below except `verify-sender-capture.sh` (`--base-url`, same default) and `verify-receiver-failure.sh` |
| `--central-url` | `https://localhost:8443` | `verify-e2e-push.sh`, `verify-initial-load.sh`, `verify-sync-status.sh`, `outage-drill.sh`, `verify-conflict-resolution.sh` |
| `--user`, `--password` | `admin`, `Admin123` | all below except `verify-receiver-failure.sh` |
| `--central-user`, `--central-password` | the `--user` values | `verify-e2e-push.sh`, `verify-initial-load.sh`, `outage-drill.sh`, `verify-conflict-resolution.sh` |

`verify-sync-status.sh` uses `--user`/`--password` at central too. The table below lists each
script's other flags.

**Staging only.** They register fabricated patients, and several stop containers or resend a
facility's whole database. `verify-sender-capture.sh`, and `verify-e2e-push.sh` through it,
refuse to run if the sender targets an `moh.gov.lr` broker; there is no override.

| Script | Asserts | Stacks |
| --- | --- | --- |
| `verify-sender-capture.sh [--base-url] [--timeout 120]` | A patient registered over REST is captured off the binlog by the sender, by UUID; names never appear in sender logs | Facility |
| `verify-e2e-push.sh [--timeout 300]` | A patient, visit, ANC encounter with an observation, programme enrolment, test order and drug order registered at the facility all reach central intact with the same UUIDs; the sender watches exactly the tables its template declares. LE-35 criterion 1 | Both |
| `verify-sync-status.sh [--timeout 60]` | `/ws/rest/v1/liberiaemr/syncstatus` answers at central with numbers matching the broker and receiver, refuses a user without View Sync Status, and reports the feature off at a facility | Central with monitoring |
| `verify-initial-load.sh [--timeout 600]` | With its saved position moved aside, the sender resends every record (`SYNC_SNAPSHOT_MODE=initial`); every record in a synced table then exists at central with no conflicts, retries or dead letters, sync carries on, and a restart does not resend everything. Prints how to restore the old position if it fails | Both |
| `outage-drill.sh [--batch 10] [--timeout 600] [--outage-cmd] [--restore-cmd] [--allow-short-retention]` | Through a broker outage with container restarts, a counted batch registered at the facility lands at central exactly once with empty retry queues, and the facility keeps registering; `sync_binlog` and `innodb_flush_log_at_trx_commit` are both 1 (risk F11); binlog retention is at least 8553600 s (risk F1), unless `--allow-short-retention` turns that failure into a warning — lab stacks only, never a facility. LE-35 criterion 2 | Both, with `verify-e2e-push.sh` already passing |
| `verify-receiver-failure.sh [--pki ~/.liberiaemr/sync-security] [--facility careysburg] [--prom-url http://127.0.0.1:9190] [--timeout 900]` | A signed but malformed message is redelivered, dead-lettered after 10 attempts and alerted, while valid messages behind it still apply and their reply requests are ignored. Clears DLQ at the end | Central |
| `verify-conflict-resolution.sh [--prom-url http://127.0.0.1:9190] [--timeout 900]` | A real conflict (edited at central, then twice at the facility) resolved with `scripts/sync/conflicts.sh`: the waiting update applies on retry, a later change applies without a new conflict, the alert clears, no payload reaches the receiver log | Both, with a healthy baseline |
| `verify-alerting.sh [--prom-url http://127.0.0.1:9090] [--timeout 600] [--resolve-timeout 2400] [--outage-cmd] [--restore-cmd]` | Cutting the broker and registering a patient fires `SyncPushErrors` in Prometheus; restoring resolves it. Resolution waits on the sender's 30-minute retry poller. LE-35 criterion 3 | Facility with `--profile sync`, a central broker to break |

The outage scripts stop and start the central broker container by default; on a staging pair
with separate hosts pass `--outage-cmd` and `--restore-cmd`, e.g. firewall rules.

## Shared helpers

Sourced, not executed.

- `facility-records.sh` — fabricates a patient's clinical day at the facility and looks for
  it at central. Used by `verify-e2e-push.sh` and `verify-initial-load.sh`.
- `central-probe.sh` — drives a running central stack as a facility would. Used by
  `verify-receiver-failure.sh`.
