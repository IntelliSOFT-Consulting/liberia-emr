# Sync sender image (`liberia-emr-sync`)

The facility side of the unidirectional facility to central push: the dbsync sender
application from [mekomsolutions/openmrs-dbsync](https://github.com/mekomsolutions/openmrs-dbsync),
pinned by `sync.dbsync` in `distribution/distro.properties` and built by
`scripts/build/build-distribution.sh`. The design it implements is
[docs/architecture/sync-eip.md](../../docs/architecture/sync-eip.md); the route-level
contract is [integration/eip/routes/README.md](../../integration/eip/routes/README.md).

## Why it builds from source

Stock dbsync 4.0.0 refuses to start against OpenMRS 2.8.x, and LiberiaEMR pins platform
2.8.8. `patches/0001-allow-openmrs-2.8.patch` widens the version whitelist by one line;
the patch header carries the full justification, the schema analysis that makes it safe,
and the test evidence. This is a recorded deviation on LE-22. When upstream supports 2.8,
delete the patch and switch this Dockerfile to the released `-exe.jar` from Mekom's Nexus.

## What it needs to run

- The facility database with the **binary log enabled** (ROW format, FULL row image, a
  unique server id). The facility compose file sets this on the `db` service.
- A **replication-privileged database user** for Debezium and a **management schema** for
  the sender's durable queues. Both are created on the first boot of an empty database by
  `distribution/compose/facility/initdb/10-sync-db-users.sh`; for a database that already
  exists, run the statements in that script by hand once.
- The **Artemis broker** at central (the receiver build ships it). Until it exists, QA can
  point `SYNC_OUTPUT_ENDPOINT` at a `file:` endpoint, which is upstream's testing mode.
- The environment contract listed in `docker-entrypoint.sh`. The compose file wires it
  from the facility env file; the entrypoint refuses to start with anything missing.

## Durable state

`/opt/eip` (the `sync-queue` volume) holds the Debezium offset and schema history. Losing
it means re-snapshotting and re-sending; it is one of the enumerated copies of clinical
data at rest (sync-eip.md section 7.4) and is covered by the facility disk encryption
control. The queues themselves live in the management schema on the facility database.

## Verifying capture (QA)

`qa/sync/verify-sender-capture.sh` registers a patient through the facility REST API and
asserts the sender emits payloads for it. Run it against a stack started with
`--profile sync`. The same check by hand: register any patient in the UI, then watch
`docker compose logs sync` for the person and patient UUIDs (never names) being processed.
