# Runbook — deploy or upgrade an instance

## Preconditions

- Release tag published; images present in the registry.
- Release notes list the resolved versions (`distro.properties` at that tag).
- The **upgrade test passed in CI for this exact release** (see `qa/upgrade/`). A release
  that has only been clean-installed is not ready for a facility with patient data.
- A verified backup exists and its restore has been rehearsed.
- Maintenance window agreed with the facility.

## Facility deployment

```bash
cd distribution/compose/facility
cp ../../env/facility.env.example facility.env    # first time only; then fill it in
docker compose --env-file facility.env pull
docker compose --env-file facility.env up -d
```

First boot on an **empty database only**: set `OMRS_CREATE_TABLES=true` in `facility.env`,
start, wait for the health check, then set it back to `false`. Leaving it true is how a
later restart surprises you.

Watch Initializer complete before declaring success:

```bash
docker compose --env-file facility.env logs -f backend | grep -i initializer
```

The backend runs with `continue_on_error=false`, so a metadata error stops the boot. That
is intended: a half-loaded configuration is far harder to diagnose than a refused startup.

### Sync to central

The sync service starts only with `--profile sync`, so a facility deployed with the commands
above does not sync. Set `DEBEZIUM_DB_PASSWORD` and `SYNC_MGMT_DB_PASSWORD` in `facility.env`
before the database's first boot, even if sync comes later: the sync database accounts are
created on that boot only. On a database that already exists, create them by hand with the
statements in `distribution/compose/facility/initdb/10-sync-db-users.sh`.

Enrol the facility first ([sync operations](sync-operations.md) section 1): that gives it
`SYNC_CERTS_DIR`, and central the matching enrolment. Then set `FACILITY_CODE`, `ARTEMIS_URL`,
`SYNC_CERTS_DIR` and the sync account in `facility.env`, and use the profile on every command
from then on, including the upgrade and rollback commands below:

```bash
docker compose --env-file facility.env --profile sync up -d
```

On its first start the sender sends every record already in this database, one facility at a
time; section 1 of the sync runbook covers what to check first and how to tell it has finished.

## Central deployment

Central runs the same backend and frontend plus the broker, the sync receiver and their
monitoring, all in one stack:

```bash
cd distribution/compose/central
cp ../../env/central.env.example ../../env/central.env    # first time only; then fill it in
docker compose --env-file ../../env/central.env pull
docker compose --env-file ../../env/central.env up -d
```

Before the first start, `BROKER_CERTS_DIR` needs the broker's enrolment (rendered by
`scripts/security/render-broker-config.sh` from MOH-issued material) and `RECEIVER_CERTS_DIR`
the receiver's certificate and every enrolled facility's PGP key; both stacks refuse to start
without them. `ARTEMIS_BIND_ADDR` is the one interface facilities reach the broker on. The same
first-boot rule for `OMRS_CREATE_TABLES` applies. Central must run the same release as its
facilities, since both hold the same metadata ([sync-entity-coverage.md](../architecture/sync-entity-coverage.md)
section 3). Adding a facility later is section 1 of the sync runbook, not a redeploy.

## Upgrade

On a facility that syncs, add `--profile sync` to the commands below, and do not upgrade while
its first load to central is still running (sync runbook section 1). Upgrading does not make a
facility enrolled before this release send its earlier records: it already has a saved position,
so nothing is backfilled. Send them with section 11 of the sync runbook.

1. Announce the window; stop clinical use.
2. **Back up the database and verify the backup restores** — not just that the file exists.
3. `docker compose --env-file facility.env pull`
4. `docker compose --env-file facility.env up -d`
5. Watch migrations and Initializer complete.
6. Run the post-deploy checks below.
7. Release the instance back to clinical use.

## Post-deploy checks

- [ ] `/openmrs/health/started` returns healthy
- [ ] O3 loads and a test user can log in
- [ ] Login location list shows this facility's locations
- [ ] A patient can be searched and their chart opens
- [ ] MCH programme enrolments render
- [ ] Sync queue is draining (`docker compose logs sync`)
- [ ] Existing patient data is intact — spot-check records from before the upgrade

## Rollback

Images are immutable and versioned, so rolling back the application is a tag change. **The
database is not.** If migrations have run, rollback means restoring the pre-upgrade backup
and accepting the loss of anything recorded since. This is why step 2 is not optional.

```bash
# set LIBERIAEMR_VERSION to the previous release in facility.env, then:
docker compose --env-file facility.env up -d
```

On a facility that syncs, stop the sender before restoring (`docker compose --env-file
facility.env --profile sync stop sync`). Its saved position points past the restored database,
so after the restore set it aside as in section 11 of the [sync runbook](sync-operations.md)
before starting it again. The facility then sends its records again, and central applies the
ones it already has without conflict, which also means an edit made after the backup is
replaced at central by the restored version. Records created after the backup stay at central
although the facility has lost them.
