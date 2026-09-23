# Monitoring

Prometheus and Alertmanager for the sync layer: one pair per stack, watching the sender at a
facility and the receiver, broker and sync certificates at central. Design:
[sync-eip.md](../../docs/architecture/sync-eip.md). The compose files mount this directory
read-only; only the certificate expiry exporter is built into an image.

| File | Purpose |
| --- | --- |
| `prometheus-facility.yml` | Scrapes the sender (`sync:8080/actuator/prometheus`) every 30 s and sends alerts to `alertmanager:9093` |
| `rules-facility.yml` | Facility alert rules, group `sync-sender` |
| `prometheus-central.yml` | Scrapes the receiver (`sync-receiver:8080/actuator/prometheus`), the broker (`artemis:8161/metrics/`) and the exporter (`cert-expiry:9101`) |
| `rules-central.yml` | Central alert rules, groups `sync-receiver`, `sync-broker` and `sync-certificates` |
| `alertmanager-entrypoint.sh` | Renders Alertmanager's configuration from `ALERT_*` and starts it |
| `cert-expiry/` | `liberia-emr-cert-expiry`: certificate and revocation list expiry as metrics |
| `tests/rules-central-test.yml` | promtool unit tests for `rules-central.yml` |

## How the stacks wire it

| | Facility | Central |
| --- | --- | --- |
| `prometheus` (`prom/prometheus:v2.53.4`) | `sync` profile | always |
| `alertmanager` (`prom/alertmanager:v0.27.0`) | `sync` profile | always |
| `cert-expiry` | — | always |

Each stack mounts its own `prometheus-<stack>.yml` as `/etc/prometheus/prometheus.yml` and
`rules-<stack>.yml` as `/etc/prometheus/rules.yml`, and keeps history in the `prom-data`
volume. Alertmanager mounts this whole directory at `/etc/amtpl` and runs
`alertmanager-entrypoint.sh` from it, with state in `alertmanager-data`.

Both UIs publish on `PROM_BIND_ADDR`, `127.0.0.1` by default, at `PROM_PORT` (9090) and
`ALERTMANAGER_PORT` (9093). Reach them over an SSH tunnel; bind another address only
deliberately.

At central the backend reads this Prometheus for the sync status page, through
`LIBERIAEMR_SYNC_MONITORING_URL` (`http://prometheus:9090` by default; empty turns the page
off). A facility does not set it.

## Alerts

Facility (`rules-facility.yml`):

| Alert | Fires when | Severity |
| --- | --- | --- |
| `SyncPushErrors` | the sender's error queue is non-empty for 5 minutes | warning |
| `SyncPushErrorsSustained` | the same, for 2 hours | critical |
| `SyncSenderDown` | the sender cannot be scraped for 5 minutes | critical |
| `SyncSenderDatasourceDown` | the sender cannot reach the facility database | critical |

Central (`rules-central.yml`):

| Alert | Fires when | Severity |
| --- | --- | --- |
| `ReceiverErrors` | the receiver's error queue is non-empty | critical |
| `ReceiverConflicts` | records are in the conflict queue | warning |
| `ReceiverDown`, `ReceiverDatasourceDown` | the receiver cannot be scraped, or cannot reach the central database | critical |
| `SyncDeadLetters` | anything is in the broker's `DLQ` | critical |
| `SyncFacilitySilent` | a facility that was sending has sent nothing for three days | warning |
| `SyncBrokerDown` | the broker's metrics endpoint does not answer | critical |
| `SyncCertExpiresIn90Days`, `60Days`, `30Days` | a sync certificate expires within that many days | info, warning, critical |
| `SyncCrlStale` | a quarter or less of the revocation list's validity is left | critical |
| `SyncCrlInvalid` | the revocation list in place does not verify against the CA | critical |
| `SyncCertExpiryBlind` | the exporter read no certificate, hit a read error, or found no revocation list | warning |
| `SyncCertExpiryExporterDown` | the exporter is down, or has not refreshed for 3 hours | warning |

Operating procedures for the sync alerts are in
[docs/runbooks/sync-operations.md](../../docs/runbooks/sync-operations.md) and
[broker/README.md](../broker/README.md#operating-it).

## Alert delivery

`alertmanager-entrypoint.sh` sends every alert to each channel that is configured, grouped by
alert name, repeating every 4 hours, with resolutions:

| Variable | Meaning |
| --- | --- |
| `ALERT_WEBHOOK_URL` | A webhook (Slack, Teams, an SMS gateway) |
| `ALERT_EMAIL_TO` | Comma-separated recipients; needs `ALERT_EMAIL_FROM` and `ALERT_SMTP_SMARTHOST` (`host:port`) |
| `ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD` | Optional relay login; a user without a password is refused |
| `ALERT_SMTP_REQUIRE_TLS` | `true` (default) requires STARTTLS; `false` only for a relay on a trusted network |

The webhook URL and SMTP password are written to files Alertmanager reads, never into the
YAML, and every other value is checked before it is quoted in. An incomplete or malformed
email configuration stops the container. With no channel at all it starts, warns, and
alerts are visible in the UIs only, which is acceptable on a development box and nowhere else.

## Certificate expiry exporter

`cert-expiry/cert-expiry.sh`, run as uid 10001 in `liberia-emr-cert-expiry`. At central it
mounts the broker's `public/` directory (`${BROKER_CERTS_DIR}/public`) read-only at `/public`,
so an expiring facility certificate alerts while that facility is offline. It reads
`certs/*.pem` and `crl.pem` there, nothing private, and serves `:9101/metrics`, refreshed
every `REFRESH_SECONDS` (3600 by default). `--once` prints the metrics and exits.

| Metric | Meaning |
| --- | --- |
| `sync_cert_not_after_seconds{identity,kind}` | Expiry of each certificate; `kind` is `ca`, `broker`, `receiver`, `admin` or `facility`, from the file name |
| `sync_crl_next_update_seconds`, `sync_crl_last_update_seconds` | The revocation list's validity window |
| `sync_crl_valid` | 1 when the list verifies against `certs/ca.pem` |
| `sync_cert_files_read`, `sync_cert_read_errors` | What the last run read, and failed to |
| `sync_cert_expiry_last_run_seconds` | When it last ran |

## Testing

```bash
docker run --rm -v "$PWD/distribution/monitoring:/m:ro" --entrypoint promtool \
  prom/prometheus:v2.53.4 test rules /m/tests/rules-central-test.yml
```

The tests cover the broker and certificate rules; the receiver group, `SyncBrokerDown` and
the facility rules have none. CI's `sync-hardening` job runs them, together with
`qa/sync/verify-alert-delivery.sh` (email over STARTTLS and webhook, and the entrypoint's
refusals) and the exporter against freshly issued material, whenever anything under
`distribution/monitoring/` changes. `qa/sync/verify-alerting.sh` exercises a real push
failure end to end.
