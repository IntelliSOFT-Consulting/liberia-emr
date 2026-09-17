# Runbook: sync operations

Operating the facility to central push day to day: enrolling and removing facilities,
rotating certificates and keys, and handling what the alerts raise. The design is
[sync-eip.md](../architecture/sync-eip.md); the broker and images are described in
[distribution/broker/README.md](../../distribution/broker/README.md) and
[distribution/sync/README.md](../../distribution/sync/README.md).

**Rehearsal status:** sections 7 to 9 and 11 are exercised by the `qa/sync/` checks named in
them. Sections 1 to 6 have not yet been rehearsed end to end with MOH-issued material; do that
before go-live.

Commands assume the repository is checked out on the host and the stacks run with Docker
Compose. At central, `central` below stands for
`docker compose -f distribution/compose/central/docker-compose.yml --env-file distribution/env/central.env`;
at a facility, `facility` stands for
`docker compose -f distribution/compose/facility/docker-compose.yml --env-file <facility env> --profile sync`.
After changing an env file, apply it with `up -d <service>`; `restart` keeps the old values.

## Where things are

| What | Where |
| --- | --- |
| Broker enrolment and server certificate | `BROKER_CERTS_DIR` at central, readable by uid 1001; `public/` also by uid 10001 |
| Receiver certificate and PGP keys | `RECEIVER_CERTS_DIR` at central, readable by uid 999 |
| Facility certificate and PGP key | `SYNC_CERTS_DIR` at the facility, readable by uid 999 |
| Operator (admin) certificate | Kept off the servers; brought to central only for an admin session |
| CA, revocation list, PGP key custody | MOH ICT Unit |

Operator tools, run at central:

- `scripts/sync/broker-admin.sh --admin <admin dir> <artemis command>` runs the Artemis CLI
  with the admin certificate on the broker's loopback acceptor.
- `scripts/sync/conflicts.sh` lists and resolves conflicts.

Useful checks: `broker-admin.sh ... queue stat --queueName DB-SYNC-REC.DB-SYNC-RECEIVER`
(messages waiting for the receiver) and `... --queueName DLQ`.

## 1. Enrol a facility

A facility code is lowercase letters, digits and hyphens (`careysburg`). It names the
certificate, the PGP key and the broker address, and must be the facility's `FACILITY_CODE`.

1. **Certificate.** The MOH ICT Unit issues a client certificate with subject
   `C=LR, O=MOH LiberiaEMR, CN=<code>` and extended key usage `clientAuth`, as a PKCS#12
   file with its password, plus a truststore holding the CA.
2. **PGP key.** On an offline machine, with a passphrase from the password manager:

   ```bash
   export GNUPGHOME="$(mktemp -d)"
   gpg --batch --pinentry-mode loopback --passphrase "$PASS" --quick-gen-key '<code@sync.liberiaemr>' rsa3072 sign never
   FPR="$(gpg --batch --with-colons --list-keys '<code@sync.liberiaemr>' | awk -F: '/^fpr/ {print $10; exit}')"
   gpg --batch --pinentry-mode loopback --passphrase "$PASS" --quick-add-key "$FPR" rsa3072 encr never
   gpg --batch --armor --export '<code@sync.liberiaemr>' > <code>-pub.asc
   gpg --batch --pinentry-mode loopback --passphrase "$PASS" --armor --export-secret-keys '<code@sync.liberiaemr>' > <code>-sec.asc
   ```

   The user id must be exactly `<code@sync.liberiaemr>`, the id the facility's sender signs
   with; the receiver only reads a message signed by the key its header names.
3. **Facility material.** Build `SYNC_CERTS_DIR` for the facility:

   ```
   client.p12  client.pass  truststore.p12  truststore.pass  pgp.pass
   pgp/<code>-sec.asc  pgp/sync-receiver-pub.asc
   ```

   Give it to uid 999, mode 600 for files and 700 for directories, and install it at the
   facility by a person or over a trusted remote session. `<code>-sec.asc` never leaves the
   facility after that.
4. **Central.** Copy `<code>-pub.asc` into `RECEIVER_CERTS_DIR/pgp/`. Re-render the broker
   enrolment with the full facility list, then restart the broker and the receiver (it reads
   PGP keys only at start):

   ```bash
   scripts/security/render-broker-config.sh --out "$BROKER_CERTS_DIR" --ca ca.pem \
     --broker-cert broker.pem --receiver sync-receiver.pem --admin broker-admin.pem \
     --facility careysburg=careysburg.pem --facility <code>=<code>.pem
   central restart artemis && central restart sync-receiver
   ```
5. **Facility.** Set `FACILITY_CODE`, `ARTEMIS_URL=ssl://<central host>:61617`,
   `SYNC_CERTS_DIR` and the sync account (section 6) in the facility env, then `facility up -d`.

   On its first start the sender sends every record already in the facility database, then
   carries on with new changes (`SYNC_SNAPSHOT_MODE=initial`). The clinic can keep working
   while it runs, but changes made meanwhile wait behind the load. It sent a few records a
   second on the test stacks, so a database of hundreds of thousands of records takes hours
   to days; time it on a copy of the facility's data first. Before that start:
   - Enrol one facility at a time. The load reads the whole database, and central applies it
     alongside every other facility's live changes.
   - Remove any record that must never reach central, such as training data, before enrolling.
     `SYNC_SNAPSHOT_MODE=schema_only` skips what is already there, but it defers rather than
     excludes: the first edit to one of those records sends it, and central takes it as a new
     record. The setting is read until the first load has completed, and again only if the
     saved position is lost or set aside (section 11).
   - Watch the facility database's CPU and disk while the load runs. The sender's own queue
     table is scanned and sorted every five seconds until it drains, and upstream has no index
     on it, so a large load keeps that scan going for as long as it lasts.
   - Do not upgrade the facility until the load has finished: a migration that changes a table
     the load is still reading waits for it, and the clinic's saves to that table wait too.
6. **Check.** The sender logs `Started Application`; the receiver logs
   `Entity: ..., source=<code>` as the facility's changes arrive; Prometheus at central shows
   `sync_cert_not_after_seconds{identity="<code>"}`. The first load is finished when the sender
   has logged `Snapshot ended with SnapshotResult [status=COMPLETED`, the facility's
   Prometheus shows `openmrs_dbsync_watcher_db_events` and `openmrs_dbsync_watcher_errors` at 0,
   and `queue stat` shows nothing waiting for the receiver, with `ReceiverErrors`,
   `ReceiverConflicts` and `SyncDeadLetters` quiet. `qa/sync/verify-initial-load.sh` rehearses
   this on staging and compares the record ids in every synced table at both ends.

## 2. Remove or revoke a facility

The receiver cannot read a message signed by a key it no longer holds: such a message fails,
restarts the receiver for each of its 10 delivery attempts, and ends in DLQ. So the key is
removed only after the facility's messages have drained.

- **Closing a facility:** stop its sender, wait until the subscription queue is empty, then
  re-render the enrolment without it, remove its `-pub.asc` from `RECEIVER_CERTS_DIR/pgp/`, and
  restart the broker and the receiver. That removes its broker address, so
  `SyncFacilitySilent` clears within three days; until the enrolment is re-rendered the alert
  keeps firing for it, so silence it in Alertmanager for as long as that takes.
- **Stolen or compromised server:** revoke its certificate at once (section 3); the broker
  refuses it from then on, even though the facility cannot be reached. Then decide what to do
  with its messages already queued at central. If they can still be trusted, let them drain
  before removing its key. If not, stop the receiver, export them as evidence, then remove its
  key and enrolment and start the receiver:

  ```bash
  central stop sync-receiver
  scripts/sync/broker-admin.sh --admin <admin dir> consumer \
    --destination 'queue://openmrs.sync.topic::DB-SYNC-REC.DB-SYNC-RECEIVER' --filter "_AMQ_VALIDATED_USER='<code>'" \
    --break-on-null --receive-timeout 5000 --data <code>-queued-$(date +%Y%m%dT%H%M%S).xml
  ```

  Repeat with a new file until none are left. Removing the key while they are still queued
  would make each one restart the receiver 10 times, stopping sync for every facility for
  minutes per message.

  The receiver may already have taken some of its messages in. The broker's own record of who
  sent them is gone by then, and the facility code inside a message is written by the sending
  server: dbsync checks the signature but not that the code matches the key that signed it
  (sync-eip.md 7.2). A stolen server can therefore label its messages as another facility, so go
  by arrival time and treat the code as a hint. List what arrived since the compromise in the
  management schema (`central exec db mariadb -u <SYNC_MGMT_DB_USER> -p <SYNC_MGMT_DB_NAME>`),
  review it with the security reviewer, and remove what is not trusted:

  ```sql
  SELECT 'waiting' AS queue, id, date_created, model_class_name, identifier,
         JSON_VALUE(entity_payload, '$.metadata.sourceIdentifier') AS labelled
  FROM receiver_sync_msg WHERE date_created >= '<when the compromise may have started>'
  UNION ALL
  SELECT 'retrying', id, date_created, model_class_name, identifier,
         JSON_VALUE(entity_payload, '$.metadata.sourceIdentifier')
  FROM receiver_retry_queue WHERE date_created >= '<when the compromise may have started>';
  ```

## 3. Replace the revocation list

`SyncCrlStale` fires when the loaded list has a quarter of its validity left; a revocation
needs a new list straight away.

1. Get the new `crl.pem` from the MOH ICT Unit and check it against the CA:
   `openssl crl -in crl.pem -CAfile "$BROKER_CERTS_DIR/public/certs/ca.pem" -noout` prints
   `verify OK`.
2. Copy it to `"$BROKER_CERTS_DIR/public/crl.pem.new"`, readable by uids 1001 and 10001, then
   swap it in atomically: `mv "$BROKER_CERTS_DIR/public/crl.pem.new" "$BROKER_CERTS_DIR/public/crl.pem"`.
3. The broker restarts itself within seconds. Facility connections drop for a moment and
   senders retry; `SyncPushErrors` may fire briefly at facilities. A list that does not verify
   against the CA is not loaded and `SyncCrlInvalid` fires; one that has already lapsed is not
   loaded either, and `SyncCrlStale` stays raised.

## 4. Rotate certificates and keys

- **Facility certificate** (`SyncCertExpiresIn90Days` for its identity): issue a new one with
  the same subject, replace `client.p12` and `client.pass` at the facility, and
  `facility restart sync`. Re-render the enrolment at central so the expiry exporter sees the
  new date.
- **Broker certificate:** replace `broker.p12` and `broker.pass`, keeping every host name
  facilities use in its names. Re-render the enrolment with the new `--broker-cert`, then
  `central restart artemis`. Facilities trust the CA, so nothing changes there.
- **A facility's PGP key:** the receiver holds one key per facility, so the old and new cannot
  overlap. Stop the facility's sender (changes queue locally), wait until the subscription queue
  is empty, replace `<code>-pub.asc` at central and restart the receiver, then install the new
  `<code>-sec.asc` at the facility and start the sender.
- **The receiver's PGP key:** a planned outage, because every facility encrypts to it.
  1. Stop every sender you can reach and let the subscription queue drain.
  2. Re-render the enrolment without every facility that does not yet have the new
     `sync-receiver-pub.asc` installed, and restart the broker. The broker then refuses those
     facilities instead of accepting messages the receiver could no longer read.
  3. Replace `sync-receiver-sec.asc` and restart the receiver.
  4. As each facility gets the new public key, restart its sender and enrol it again.

  Keep the old private key in MOH ICT custody: a message encrypted to it that reaches DLQ can
  only be read with it.

## 5. Upgrade from the interim broker

The interim `apache/activemq-artemis` broker used a password and an unencrypted journal on
the `artemis-data` volume; this broker uses a new `broker-data` volume.

1. Stop every facility's sender; changes queue locally.
2. Wait until the old broker's receiver subscription is empty, so nothing is left in its journal.
3. Re-render the enrolment with this release's `scripts/security/render-broker-config.sh` (it
   adds the operator permissions sections 2 and 7 use) and deploy (`central up -d`).
4. Start the senders again, then delete the old journal:
   `docker volume rm liberiaemr-central_artemis-data`.

## 6. The sync service accounts

The sender and the receiver sign in to their OpenMRS instance with dedicated accounts, never
`admin`. The national content package defines the roles; until content packages are assembled
into the distribution, create them by hand with exactly these privileges:

| Role | Privileges | Used by |
| --- | --- | --- |
| `Sync Sender` | View Administration Functions | the facility sender (platform version at start) |
| `Sync Receiver` | View Administration Functions, Get People, Get Patients, Get Patient Identifiers, Get Users | the central receiver (platform version, cache and search index updates) |

Create a user for each with a generated password and that role alone, set `SYNC_REST_USER`
and `SYNC_REST_PASSWORD` in the env file, and apply it with `up -d`. A receiver missing a
privilege logs `statusCode: 403` for `cleardbcache` or `searchindexupdate`, and synced patients
then do not show up in search at central.

## 7. Dead letters: `SyncDeadLetters`

The receiver failed on a message 10 times, restarting each time, and the broker set it aside
so the rest could flow. The message is not in the national record.

1. Find the cause: `central logs sync-receiver | grep 'An error occurred, cause'`.
2. Fix it: a receiver bug, a malformed payload, or a message signed by a key the receiver no
   longer holds (section 2). A record that fails to apply at central, such as missing metadata,
   does not come here; it waits in the retry queue and raises `ReceiverErrors`.
3. Check the record has not changed since. dbsync applies a message over whatever central
   holds, so replaying an old message after newer updates to the same record have applied
   silently turns the record back. The dead letter itself is encrypted; the receiver's log line
   `Entity: ..., identifier=<uuid>` just before its error names the record, when the message got
   that far. If newer updates for the record have applied, or the record cannot be identified,
   do not replay: export the message as below and have the facility save the record again,
   which sends it in full. (The receiver acknowledges messages one at a time, so messages behind
   a failing one keep applying while it is retried; that is why this check matters.)
4. Otherwise replay one message at a time, so a message whose cause is not fixed does not
   restart the receiver another 10 times:

   ```bash
   scripts/sync/broker-admin.sh --admin <admin dir> transfer --source-queue DLA::DLQ \
     --target-topic openmrs.sync.topic --message-count 1
   ```

   It keeps its signature, so the receiver checks it again like any other message. A message
   that cannot be fixed is exported as evidence, and the reason recorded:

   ```bash
   scripts/sync/broker-admin.sh --admin <admin dir> consumer --destination queue://DLA::DLQ \
     --break-on-null --receive-timeout 5000 --data dead-letter-$(date +%Y%m%dT%H%M%S).xml
   ```

   The export stops after 1000 messages; repeat with a new file until `queue stat` shows none.

`qa/sync/verify-receiver-failure.sh` and `qa/sync/verify-hardening.sh` exercise this section.

## 8. Conflicts: `ReceiverConflicts`

Central's copy of a record was changed outside sync, so a facility's update to it is held back,
along with every later update to that record (which also raises `ReceiverErrors`). Central is
meant to be read-only for clinical data, so also find out what changed it. The procedure is
dbsync's own, from its README ("Conflict Resolution In The Receiver" and "Updating Entity
Hashes"); `scripts/sync/conflicts.sh` runs its steps.

1. `scripts/sync/conflicts.sh list` shows each queued conflict's table, UUID, how many updates
   are waiting behind it, and whether it is still open.
2. Decide which version of the record is right, with the clinical owner at the facility. The
   facility is the record's source: if central's change was the right one, make it at the
   facility too. The conflicting payload stays in the management database; do not copy it out.
3. Resolve every conflict `list` queues for that table, naming each one you reviewed, including
   any left as "resolved, not removed" by an interrupted run:

   ```bash
   scripts/sync/conflicts.sh resolve --table <table> --conflict <id>[,<id>...] --by "<name, role>" --reason "<why>"
   ```

   It refuses before touching anything if the compose and env files no longer describe the
   deployed receiver. It then stops the receiver, and refuses again if the table's queued
   conflicts are not exactly those you named (dbsync's hash updater needs all of them resolved).
   It marks them resolved, runs the hash updater for that table as a one-off container, removes
   those rows (which clears the alert and the stored payloads), and starts the receiver again if
   it was running. If the hash update fails or the
   run is interrupted, the conflicts are reopened and the same command can be run again. The
   decision goes to the host's syslog under `liberiaemr-sync-conflicts`; record it in the
   incident log too, and never put a patient's name or identifier in the reason.

   The receiver is down while the hash updater scans the whole table: seconds for a small
   table, much longer for `obs` on a large central, and `ReceiverDown` fires after five
   minutes. Run it at a quiet time, from the directory the stack was started in, and inside
   `tmux` or `screen` so a dropped connection cannot interrupt it.
4. dbsync does not apply the conflicting update itself. Updates waiting behind it apply on the
   receiver's first retry run, about two minutes after it starts, and each carries the whole
   record. If none was waiting, have the facility save the record again.

The hash updater accepts central's current copy of every row in the table, so any other change
made at central to that table is no longer detected, including one no facility has updated over
yet and which `list` therefore cannot show. Find out what changed central (step 2) before
resolving, and resolve a table at a time rather than waiting for conflicts to collect.
`qa/sync/verify-conflict-resolution.sh` exercises this section.

## 9. Alert delivery

Alerts are delivered by email, webhook or both, set in the env file of each stack:
`ALERT_EMAIL_TO` (comma-separated), `ALERT_EMAIL_FROM`, `ALERT_SMTP_SMARTHOST` (`host:port`,
STARTTLS required unless `ALERT_SMTP_REQUIRE_TLS=false` for a relay on a trusted network),
`ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD`, and `ALERT_WEBHOOK_URL`. Apply a change with
`central up -d alertmanager` (or `facility`), then send a test alert and confirm it arrives:

```bash
central exec alertmanager amtool --alertmanager.url=http://127.0.0.1:9093 alert add SyncDeliveryTest severity=info
```

`qa/sync/verify-alert-delivery.sh` exercises this section.

## 10. A facility goes quiet: `SyncFacilitySilent`

Central has received nothing from the facility for three days. Either nothing was recorded
there, or its sync is stopped, cut off from the network, or refused at the broker (a revoked
or expired certificate). Ask the facility; its own `SyncSenderDown` and `SyncPushErrors` alerts
name the cause when its monitoring is reachable. A clinic closed for longer than three days
raises this too, and it clears on the first record after it reopens. A newly enrolled facility
is not flagged until it has been enrolled for three days.

## 11. Send a facility's records again

Needed when central lost records the facility had already sent, for example after central was
restored from an older backup, and when a sender was down for longer than the binary log is
kept (about 99 days): it then refuses to start because its saved position is no longer in the
log. A sender whose `/opt/eip` volume was lost does this by itself on its next start. Doing it
on purpose resends the facility's whole database, so do one facility at a time and at a quiet
time. Keep the old saved position under a dated name:

```bash
facility stop sync
facility run --rm --no-deps --entrypoint sh sync -c \
  'mv -T /opt/eip/.debezium "/opt/eip/.debezium.before-resend-$(date +%Y%m%d%H%M%S)" && ls -a /opt/eip'
facility start sync
```

Records central already has are applied again unchanged. Records that were deleted outright at
the facility since the sender last read are not resent; OpenMRS voids rather than deletes, so
this is rare. Check the load finished as in section 1 step 6, then remove the dated copy:

```bash
facility run --rm --no-deps --entrypoint sh sync -c 'rm -rf /opt/eip/.debezium.before-resend-<date>'
```

To go back instead, before the load has finished:

```bash
facility stop sync
facility run --rm --no-deps --entrypoint sh sync -c \
  'rm -rf /opt/eip/.debezium && mv -T /opt/eip/.debezium.before-resend-<date> /opt/eip/.debezium'
facility start sync
```

`qa/sync/verify-initial-load.sh` rehearses the same steps on staging.

## 12. Records every install shares

Every install creates the admin account, its person and name, the Unknown provider and the
admin provider with the same uuids, and central holds its own copies without a sync hash.
dbsync refuses such a record from a facility and retries it forever, so the receiver skips
them (`db-sync.excludedEntities` in `distribution/sync/receiver-application.properties.template`).
New rows attached to them still sync, so a name or attribute added to a facility's admin
person ends up on central's admin person.

A central that ran an earlier release may hold a retry item for one of them, left from an edit
to a facility admin account; it shows as `ReceiverErrors`. With the receiver stopped
(`central stop sync-receiver`), remove it in the management schema, then start the receiver:

```sql
DELETE FROM receiver_retry_queue WHERE
     (model_class_name = 'org.openmrs.eip.dbsync.model.UserModel' AND identifier = '82f18b44-6814-11e8-923f-e9a88dcb533f')
  OR (model_class_name = 'org.openmrs.eip.dbsync.model.PersonModel' AND identifier = '5f87c042-6814-11e8-923f-e9a88dcb533f')
  OR (model_class_name = 'org.openmrs.eip.dbsync.model.PersonNameModel' AND identifier = '5f897a68-6814-11e8-923f-e9a88dcb533f')
  OR (model_class_name = 'org.openmrs.eip.dbsync.model.ProviderModel'
      AND identifier IN ('f9badd80-ab76-11e2-9e96-0800200c9a66', '55bc2590-ceb2-4832-8148-d163fbdebee3'));
```
