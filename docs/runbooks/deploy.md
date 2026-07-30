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

## Upgrade

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
