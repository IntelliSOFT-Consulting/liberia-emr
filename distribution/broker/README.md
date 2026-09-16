# Sync broker (`liberia-emr-broker`)

The ActiveMQ Artemis broker at central that facilities push to. Design:
[sync-eip.md](../../docs/architecture/sync-eip.md) sections 1.4 and 7.

## What it enforces

- **Mutual TLS only.** Facilities and the receiver connect on 61617 with a certificate
  signed by the configured CA and absent from its revocation list. There is no plain
  listener and no password login.
- **One address per facility.** Facility `careysburg` may send to
  `sync.facility.careysburg` and nothing else. The broker forwards it to
  `openmrs.sync.topic`, where facilities hold no permission; only the receiver consumes.
- **Messages are kept.** The receiver's subscription queue is declared by the broker, so
  messages wait from first start even before the receiver connects (risk E11). A message
  the receiver fails on 10 times moves to `DLQ` instead of being dropped.
- **Operators only on loopback.** The admin certificate logs in on `127.0.0.1:61618`
  inside the container, never on 61617. Login results are not cached, so an operator
  session cannot be reused on the facility port.
- **Dead letters are alerted.** Broker metrics are served on 8161 (internal network only,
  no web console) and `SyncDeadLetters` fires when anything reaches `DLQ`.

Each of these is proven by `qa/sync/verify-hardening.sh`, which CI runs on every change
here. The broker also stamps the sending identity on each message while it is queued;
that is visible to operators but is not a retained audit trail, and the receiver does not
see it.

## Mounted material

`/etc/broker-certs`, readable by uid 1001:

| File | Source |
| --- | --- |
| `broker.p12`, `broker.pass` | Server certificate; its names must include `artemis` and the host name facilities use |
| `truststore.p12`, `truststore.pass` | The CA that signs client certificates |
| `public/crl.pem` | That CA's revocation list |
| `*cert-users.properties`, `*cert-roles.properties`, `sync-*.xml`, `public/certs/` | `scripts/security/render-broker-config.sh` |

`public/` holds only certificates and the revocation list; the `cert-expiry` exporter mounts
that directory, and must be able to read it as uid 10001.

Keystore passwords may use only letters, digits and `. _ ~ -`. The container refuses to
start if anything is missing or unreadable. `scripts/security/gen-sync-certs.sh` issues a
throwaway set for development and CI; production material comes from the MOH ICT Unit.

## Operating it

- **Enrol or remove a facility:** re-run `render-broker-config.sh` with the full list and
  restart. A removed facility is also refused on its next connection without a restart.
- **Revoke a certificate:** check the new list first
  (`openssl crl -in new.pem -CAfile public/certs/ca.pem -noout` prints `verify OK`), write it
  into `public/` readable by uids 1001 and 10001, then `mv` it over `crl.pem`. The broker
  restarts within seconds to load it, through the compose `restart:` policy. That drops every
  facility connection for a moment; senders retry, which can take up to their 30 minute retry
  interval and may briefly raise `SyncPushErrors`. A replacement that is unreadable, does not
  verify against the CA, or has lapsed is not loaded, and `SyncCrlInvalid` fires. Once the
  loaded list lapses Java refuses every client; `SyncCrlStale` fires with a quarter of its
  validity left.
- **Certificate expiry:** `SyncCertExpiresIn90Days`, `60Days` and `30Days` at central.
- **Dead letters:** inspect with the Artemis CLI inside the container, using the admin
  certificate on the loopback acceptor, for example
  `artemis queue stat --queueName DLQ --url 'tcp://127.0.0.1:61618?sslEnabled=true;verifyHost=false;...'`
  (host name checks add nothing on the container's own loopback).
  The admin keystore is not mounted by default; mount or copy it in only for the session.

## Upgrading from the interim broker

The interim `apache/activemq-artemis` service used a password and kept an unencrypted
journal on the `artemis-data` volume. This broker uses a new `broker-data` volume, so it
never reads that journal. Before switching, let the receiver drain the old broker and stop
the facility senders, which queue locally. After the switch, delete the old volume
(`docker volume rm liberiaemr-central_artemis-data`), because clinical data stays in its
journal files even after messages are acknowledged.
