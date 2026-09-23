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
cp distribution/env/facility.env.example distribution/env/facility.env   # first time only; then fill it in
./scripts/deploy/deploy-facility.sh --env distribution/env/facility.env
```

The script asks you to confirm the preconditions above, then pulls and starts the stack. It
does **not** take the backup and does not start sync. By hand, it is:

```bash
cd distribution/compose/facility
docker compose --env-file ../../env/facility.env pull
docker compose --env-file ../../env/facility.env up -d
```

The facility commands in the rest of this runbook run from `distribution/compose/facility`.

First boot on an **empty database only**: set `OMRS_CREATE_TABLES=true` in `facility.env`,
start, wait for the health check, then set it back to `false`. Leaving it true is how a
later restart surprises you.

Watch Initializer complete before declaring success:

```bash
docker compose --env-file ../../env/facility.env logs -f backend | grep -i initializer
```

The backend runs with `initializer.startup.load=continue_on_error`, so a metadata error does
**not** stop the boot and `/openmrs/health/started` answers healthy regardless. Read
`/openmrs/data/initializer.log` inside the backend container before declaring success. The
setting is deliberate — `fail_on_error` skips every domain after the first error; see
[demo-stack.md](demo-stack.md) "Known gaps".

### Password reset email

The `liberiaemr` module mails password reset links through an SMTP relay configured in the
env file — deployment state, never content. Set, in `facility.env` (or `central.env`):

| Variable | Value |
| --- | --- |
| `LIBERIAEMR_SMTP_HOST`, `LIBERIAEMR_SMTP_PORT` | the relay; `587` is STARTTLS, `465` SSL |
| `LIBERIAEMR_SMTP_USER` | empty for an unauthenticated local relay |
| `LIBERIAEMR_SMTP_PASSWORD_FILE` | preferred: a path **inside the container**, read verbatim |
| `LIBERIAEMR_SMTP_PASSWORD` | fallback when no file is mounted |
| `LIBERIAEMR_SMTP_FROM` | the sender address users see |
| `LIBERIAEMR_FRONTEND_URL` | the SPA address users' browsers reach, no trailing slash — the reset link is built from it |

Neither compose file mounts a password file for the backend, so `_FILE` needs a read-only
bind or `secrets:` entry added for it. Unset, no reset mail reaches anyone: acceptable on a
dev box, never at a facility. A user can reset only if their account carries an email
address. Details: [modules/liberiaemr/README.md](../../modules/liberiaemr/README.md).

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
docker compose --env-file ../../env/facility.env --profile sync up -d
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
3. `docker compose --env-file ../../env/facility.env pull`
4. `docker compose --env-file ../../env/facility.env up -d`
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
docker compose --env-file ../../env/facility.env up -d
```

On a facility that syncs, stop the sender before restoring (`docker compose --env-file
../../env/facility.env --profile sync stop sync`). Its saved position points past the restored
database, so after the restore set it aside as in section 11 of the [sync runbook](sync-operations.md)
before starting it again. The facility then sends its records again, and central applies the
ones it already has without conflict, which also means an edit made after the backup is
replaced at central by the restored version. Records created after the backup stay at central
although the facility has lost them.
