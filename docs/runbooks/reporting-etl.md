# Runbook: the reporting ETL

The MOH indicator reports read a local reporting schema, `liberiaemr_etl`, that the reporting
ETL builds from the instance's own `openmrs` database. This runbook is for operating it: how it
is deployed and configured, how to tell whether it is healthy, how to rebuild it, how a facility
differs from central, how to upgrade its core, and how an indicator is added. The decisions and
their reasons are in [ADR 0010](../adr/0010-indicator-reporting-mamba-etl.md); the module is
described in [`modules/mambaetl/README.md`](../../modules/mambaetl/README.md).

**Rehearsal status:** every command in this runbook was run on 29 September 2026 against
throwaway local stacks built from `main`: a Careysburg facility stack and a central stack, both
with synthetic data only. The facility check in section 10 also runs in CI on every pull
request that can change it. Nothing here has been run on a live facility or on the central
server, and the figures under [Measurements](#measurements) come from one laptop, not from
facility or central hardware.

Related runbooks:

- [reporting-etl-existing-database.md](reporting-etl-existing-database.md): turn the ETL on for
  a database created before it, or without `ETL_DB_PASSWORD`;
- [binlog-credentials.md](binlog-credentials.md): account passwords that older first boots
  wrote to a facility's binlog;
- [backup-restore.md](backup-restore.md): the ETL schema is inside the database backup.

Commands assume the repository is checked out on the host at the release being run. `stack`
stands for `docker compose -f distribution/compose/<facility|central>/docker-compose.yml
--env-file <env file>`; at a facility that syncs, add `--profile sync`. Two more shorthands
are used below. Define them in the shell first, with `stack` spelled out:

```bash
# SQL as root, in the ETL schema. Reads only.
etl_root() { stack exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -t liberiaemr_etl'; }
# SQL as the ETL user, in the ETL schema. Anything that changes the ETL runs as this user.
etl_user() { stack exec -T db sh -c 'exec mariadb -u"$ETL_DB_USER" -p"$ETL_DB_PASSWORD" -t liberiaemr_etl'; }
```

Both read the passwords from the `db` container's own environment, so nothing secret is typed
or shown, and both read the SQL from standard input. Both open the session **in
`liberiaemr_etl`**. That matters at a facility: the binlog filter works on the session's
default database, so a write to the ETL schema from an `openmrs` session would reach the
binlog, Debezium and the sync volume.

## 1. The deployment model

- **Every instance builds its own ETL schema from its own database, and reports on itself.**
  A facility flattens its own `openmrs`. Central flattens its `openmrs`, which dbsync fills from
  every facility, and reports on any facility, district, county or the nation.
- **Nothing is synced.** No ETL table, routine or report result moves between instances. The
  image and the report definitions are identical everywhere; only runtime settings differ.
- **Events count where they happened:** at the encounter's location, or the visit's when the
  encounter has none. Never at the patient's home facility.
- **Central lags.** For one facility and period, central shows the same figures as the facility
  once dbsync has caught up and both ETLs have run since. Until then central is behind by the
  sync delay plus up to one ETL interval. The report page says so.

What runs:

| Piece | What it does |
| --- | --- |
| `mamba-etl-liberiaemr` OMOD (`modules/mambaetl`) | On every backend start, `setupEtl()` deploys the ETL's routines into `liberiaemr_etl` as the ETL user and recreates the MariaDB event `_mamba_etl_scheduler_event`. A failed deploy is only logged, as `Failed to deploy MambaETL`; OpenMRS keeps starting. |
| `_mamba_etl_scheduler_event` | Fires at once, then every `ETL_INTERVAL_SECONDS`. Each tick calls `sp_mamba_etl_schedule()`, which runs the ETL unless a run is still going. The first run is a full one; later runs are incremental. |
| `liberiaemr-reports` OMOD (`modules/liberiaemrreports`) | The five MOH reports. They read only `liberiaemr_etl`, over the OpenMRS connection. |
| Report page (`@liberiaemr/esm-liberia-reports-app`) | Runs and exports the reports, and shows when the ETL last ran. |

## 2. Settings

**Per-stack runtime settings.** The backend service sets them as `OMRS_EXTRA_*` variables,
which the image's `startup-init.sh` turns into runtime properties on every start
(`OMRS_EXTRA_A_B__C` becomes `a.b_c`). They are in
`distribution/compose/{facility,central}/docker-compose.yml`:

| Runtime property | Variable on `backend` | Facility | Central |
| --- | --- | --- | --- |
| `mambaetl.analysis.db.openmrs_database` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_OPENMRS__DATABASE` | `${MYSQL_DATABASE}` | `${MYSQL_DATABASE}` |
| `mambaetl.analysis.db.etl_database` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_ETL__DATABASE` | `liberiaemr_etl` | `liberiaemr_etl` |
| `mambaetl.analysis.db.username` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_USERNAME` | `${ETL_DB_USER:-mambaetl}` | same |
| `mambaetl.analysis.db.password` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_PASSWORD` | `${ETL_DB_PASSWORD:-}` | same |
| `mambaetl.analysis.locale` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_LOCALE` | `en` | `en` |
| `mambaetl.analysis.columns` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_COLUMNS` | `40` | `40` |
| `mambaetl.analysis.incremental_mode` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_INCREMENTAL__MODE` | `1` | `1` |
| `mambaetl.analysis.automated_flattening` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_AUTOMATED__FLATTENING` | `0` | `0` |
| `mambaetl.analysis.etl_interval` (seconds) | `OMRS_EXTRA_MAMBAETL_ANALYSIS_ETL__INTERVAL` | `${ETL_INTERVAL_SECONDS:-1800}` | `${ETL_INTERVAL_SECONDS:-3600}` |

An operator therefore sets only `ETL_DB_USER`, `ETL_DB_PASSWORD` and `ETL_INTERVAL_SECONDS`, in
`facility.env` or `central.env` (templates in `distribution/env/*.env.example`). Everything
else is fixed in the compose file. The schema name is fixed on purpose: the facility's
`--binlog-ignore-db` flag and the initdb grants name it too.

- **A changed value applies when the backend is recreated** (`stack up -d backend`).
  `startup-init.sh` merges the variables into `/openmrs/data/openmrs-runtime.properties`,
  environment first. A variable *removed* from compose leaves its last value in that file.
- **The interval must exceed one incremental run.** Core's stuck-run check assumes it. Both
  defaults are provisional; see [Measurements](#measurements).
- **The ETL password is also stored in `openmrs-runtime.properties`,** beside
  `connection.password`, on the `openmrs-data` volume. To change it, rotate it the way
  [binlog-credentials.md](binlog-credentials.md) section 2 rotates the other accounts:
  `ALTER USER` with `sql_log_bin = 0`, then the env file, then recreate `backend`.

**`LIBERIAEMR_INSTANCE_ROLE`.** The reports module reads it to decide what a report may cover.
It is hard-coded in each compose file, `facility` in the facility stack and `central` in the
central stack, and is deliberately **not** read from the env file. Anything but `central`,
including unset or misspelt, is treated as a facility:

| | `facility` | `central` |
| --- | --- | --- |
| Report `location` | defaults to the facility root (`liberiaemr.facility.locationUuid`, seeded by the site package) and is clamped to it and its descendants; any other location fails the run | any County, District or Health Facility; empty means national |
| `by_facility` data set | absent | one row per facility in scope |
| Report page | location fixed to "this facility" | location picker over the MFL hierarchy |

To see what an instance believes it is, as a user holding *Export National Report*:

```bash
curl -sk -u <user> https://<host>/openmrs/ws/rest/v1/liberiaemrreports/context
```

It returns `instanceRole`, `facilityLocation` (null at central), `etlSchema` and `etlLastRun`.

## 3. MariaDB flags, and why the ETL user has no SUPER

The `db` service's `command:` sets these for the ETL. Each takes effect when the `db`
container is recreated (`stack up -d db`):

| Flag | Facility | Central | Why |
| --- | --- | --- | --- |
| `--event-scheduler=ON` | yes | yes | The ETL is scheduled as a MariaDB event. Core's deploy script would switch the scheduler on itself with `SET GLOBAL event_scheduler = ON`, which needs SUPER; the build strips that statement, and this flag replaces it. |
| `--performance-schema=ON` | yes | yes | Core's stuck-run check reads `performance_schema.events_statements_current` on every tick to see whether the previous run is still going. |
| `--performance-schema-consumer-events-statements-current=ON` | yes | yes | MariaDB ships that consumer switched off. Without it the check reads no rows, treats a running ETL as stuck, and the next tick can start an overlapping run. |
| `--log-bin-trust-function-creators=1` | yes | no | With a binlog on, creating a function needs SUPER unless this is set, and core creates `DETERMINISTIC` functions. Central has no binlog. |
| `--binlog-ignore-db=liberiaemr_etl` | yes | no | Keeps the ETL schema out of the binlog, and so out of Debezium, the sync volume and 99 days of binlog on disk. Central has no binlog. |

**Why not SUPER.** SUPER is a server-wide privilege: with it, an application credential could
change global settings, kill other sessions and write through `read_only`. The ETL needs it for
two narrow things only, and a server flag covers each: switching the event scheduler on, and
creating functions while a binlog is on. What `log_bin_trust_function_creators=1` gives up is a
guard against a non-deterministic function replayed *statement-based* on a replica. The
facility binlog is ROW format, its only reader is Debezium, which reads row events, and the ETL
user is the only account that creates routines. This is control B2, least privilege
(`docs/security/moh-ict-sop-mapping.md`). If central ever enables a binlog, add both
facility-only flags there with it.

To check the flags on a running instance:

```bash
etl_root <<'SQL'
SELECT @@event_scheduler, @@performance_schema, @@log_bin, @@log_bin_trust_function_creators;
SELECT NAME, ENABLED FROM performance_schema.setup_consumers WHERE NAME = 'events_statements_current';
SQL
```

Expect `ON` and `1`; then `1` and `1` at a facility, `0` and `0` at central; and the consumer
`YES`.

## 4. The ETL user and its grants

An initdb script creates the user and schema on the **first boot of an empty data volume**,
when `ETL_DB_PASSWORD` is set. It runs with `sql_log_bin = 0`, so the password never reaches a
facility's binlog.

| Grant | Facility | Central | Script |
| --- | --- | --- | --- |
| `ALL` on `liberiaemr_etl.*` to the ETL user | yes | yes | facility `initdb/20-etl-db-user.sh`, central `initdb/30-etl-db-user.sh` |
| `SELECT` on the OpenMRS schema (`MYSQL_DATABASE`) to the ETL user | yes | yes | same |
| `SELECT` on `performance_schema.events_statements_current` to the ETL user | yes | yes | same |
| `SELECT` on `openmrs_identity.*` to the ETL user, so central counts each person once by CPI | no | yes | central `30-etl-db-user.sh` |
| `SELECT` on `liberiaemr_etl.*` to the OpenMRS user, because the reports read the ETL over the OpenMRS connection | yes | yes | same scripts |
| Column-level `SELECT` on the sync sender's queue metadata to the ETL user (EMR-OPS-005) | when `SYNC_MGMT_DB_PASSWORD` is set | no | facility `initdb/30-etl-sync-queue-grant.sh`, applied by a one-off event once the sender has created its tables |

The ETL user holds nothing on `*.*` beyond `USAGE`, and never writes `openmrs`. On a database
created without the user, follow
[reporting-etl-existing-database.md](reporting-etl-existing-database.md), which reruns the same
script.

To list the grants without printing the password hash:

```bash
stack exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N \
  -e "SHOW GRANTS FOR \`${ETL_DB_USER:-mambaetl}\`@\`%\`"' | sed 's/ IDENTIFIED BY .*//'
```

To confirm that the ETL was deployed **as** that user, so that every routine and event is
defined by it:

```bash
etl_root <<'SQL'
SELECT DEFINER, COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = 'liberiaemr_etl' GROUP BY DEFINER;
SELECT EVENT_NAME, DEFINER, STATUS, INTERVAL_VALUE, INTERVAL_FIELD
  FROM information_schema.EVENTS WHERE EVENT_SCHEMA = 'liberiaemr_etl';
SQL
```

Expect one definer, `mambaetl@%` (or your `ETL_DB_USER`), and `_mamba_etl_scheduler_event`
`ENABLED` every `ETL_INTERVAL_SECONDS` seconds. **Never call ETL routines or recreate the event
as root**: routines and events must keep the ETL user as their definer.

## 5. Is the ETL healthy?

**The report page** shows the last run: when it finished and whether it succeeded. Look there
first when figures seem stale.

**The run log, `_mamba_etl_schedule`.** Core keeps the latest 20 runs:

```bash
etl_root <<'SQL'
SELECT id, start_time, end_time, execution_duration_seconds AS secs, transaction_status,
       completion_status, success_or_error_message AS message, next_schedule
  FROM _mamba_etl_schedule ORDER BY id DESC LIMIT 10;
SQL
```

Read each row like this:

| `transaction_status` | `completion_status` | `message` | Meaning |
| --- | --- | --- | --- |
| `COMPLETED` | `SUCCESS` | NULL, with an `end_time` | a genuine success |
| `RUNNING` | NULL | NULL | a run in progress, or one that died, for example in a restart; the next tick decides which |
| `COMPLETED` | `SUCCESS` | `Stuck schedule updated` | **not a success**: a run left `RUNNING` that core closed on a later tick. Its times are reset, not the run's own |
| `COMPLETED` | `SUCCESS` | `Error schedule updated` | **not a success**: a run that ended in error, relabelled by core on a later tick |

Core rewrites the previous row on each tick, so a failed run shows only in the message. The
report page maps these four cases to *Success*, *Running*, *Interrupted* and *Error*.

**The error log, `_mamba_etl_error_log`.** Every failed procedure writes a row here:

```bash
etl_root <<'SQL'
SELECT id, error_time, procedure_name, error_code, sql_state, LEFT(error_message, 300) AS error
  FROM _mamba_etl_error_log ORDER BY id DESC LIMIT 20;
SQL
```

It should be empty. Two things to know:

- **It is recreated, empty, on every backend start**, because core's deploy drops and recreates
  it. It holds the failures since the last restart only, so read it, and save what matters,
  *before* restarting a backend to fix something.
- A concept or encounter type that the content declares but the database lacks shows up here,
  not as a build failure.

**The backend log** shows deploy failures, which reach neither table:

```bash
stack logs --no-color backend | grep -E "MambaETL|Access denied for user" | tail -20
```

`Failed to deploy MambaETL`, or `Access denied for user 'mambaetl'`, means the ETL is not
running at all. Check `ETL_DB_PASSWORD` in the env file and the grants in section 4, or follow
[reporting-etl-existing-database.md](reporting-etl-existing-database.md).

**At a facility, the binlog must hold nothing from the ETL.** This counts the events that name
the ETL schema, over every binlog file; expect `0`:

```bash
stack exec -T db sh -c '
  m() { mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B "$@"; }
  for f in $(m -e "SHOW BINARY LOGS" | cut -f1); do m -e "SHOW BINLOG EVENTS IN '"'"'$f'"'"'"; done \
  | grep -c liberiaemr_etl'
```

Anything else means a write to the ETL schema was made from an `openmrs`-context session.
Replace `grep -c liberiaemr_etl` with `grep liberiaemr_etl | head` to see which.

## 6. Running the ETL now, and forcing a full rebuild

**Run once now.** The call waits until the run finishes. At central, run it inside `tmux` or
`screen`: if the SSH session drops, the run is aborted.

```bash
etl_user <<< "CALL sp_mamba_etl_schedule();"
```

If a run is already going, the call returns at once and starts nothing. Check
`_mamba_etl_schedule` for a new row.

**Force a full rebuild** after a restore, a bulk correction in `openmrs`, a change to a derived
table that must apply to old rows, or anything that deleted rows outright. Incremental runs
pick up new and changed rows, including rows that sync late or are back-dated, but they never
remove a row that was deleted from `openmrs`.

A full run **drops every `mamba_*` table first**, so reports read empty tables until it
finishes. Run it at a quiet time; at central, expect it to take as long as the first build
(see [Measurements](#measurements)).

```bash
etl_user <<'SQL'
UPDATE _mamba_etl_user_settings SET incremental_mode_switch = 0;
CALL sp_mamba_etl_schedule();
UPDATE _mamba_etl_user_settings SET incremental_mode_switch = 1;
SQL
```

Then check that the newest `_mamba_etl_schedule` row is a genuine success and that the error
log is empty (section 5). If the session is lost before the last `UPDATE`, run that `UPDATE` on
its own: until it runs, every scheduled run is a full one. A backend restart also resets the
switch, from `mambaetl.analysis.incremental_mode`.

**Restarting the backend** redeploys every routine and recreates the event, which then runs at
once, incrementally. It does not rebuild the tables.

## 7. Facility and central, side by side

| | Facility | Central |
| --- | --- | --- |
| Source | its own `openmrs` | `openmrs`, filled by dbsync from every facility |
| Binlog | on; the ETL schema is filtered out | none |
| Flags | all five in section 3 | `event-scheduler`, `performance-schema` and its consumer |
| initdb | `20-etl-db-user.sh`, `30-etl-sync-queue-grant.sh` | `30-etl-db-user.sh`, with the `openmrs_identity` grant |
| Default interval | 1800 s | 3600 s |
| Counting people | `person_key` is the patient record | `person_key` is the primary CPI from `openmrs_identity`, so a person with records at two facilities counts once |
| Locations | the site package's own | every site package's (ADR 0012); County and District from the MFL sync |
| `LIBERIAEMR_INSTANCE_ROLE` | `facility`, hard-coded | `central`, hard-coded |
| EMR-OPS-007, EMR-OPS-015 | the facility definitions | central's own definitions, from CPI links, so they differ from the facility's by design |
| Sync backlog tables (EMR-OPS-005) | filled from the sender's queues | empty: central has no sender |
| Treatment time (`mamba_fact_malaria_drug.treated_at`) | the first live dispense's `date_handed_over`, else the order's `date_activated` | always the order's `date_activated`: `medication_dispense` is not synced |

**Consistency.** Apart from EMR-OPS-007 and EMR-OPS-015, and from the dispense-time indicators
below, a facility's report equals central's report scoped to that facility once both hold the
same rows. The reports module's unit tests
prove it for the SQL (`assertFacilityEqualsCentralForIt` and
`assertByFacilityMatchesFacilityRuns` in `IndicatorReportTestBase`), and section 10 checks it
on two stacks. If central shows different figures for a facility, then sync has not caught up,
an ETL has not run since, or the facility's locations are missing at central (the receiver
rejects records at an unknown location).

**Dispense time is facility-only (LE-358).** `medication_dispense` is not in
`eip.watchedTables`, and dbsync 4.0.0 cannot sync it
([sync-entity-coverage.md](../architecture/sync-entity-coverage.md) §4.1). This was decided on
6 October 2026: central uses the order time. The ETL is the same SQL at both instances.
`sp_mamba_fact_malaria_drug` sets `treated_at` to `dispensed_at` when the order has a live
dispense, and to `prescribed_at` (`orders.date_activated`) when it has none. At central no order
has one.

- **Which indicators.** Only a time window that reads `treated_at` or `dispensed_at` can
  differ. Today that is MAL-001 alone ("treated with ACT within 24 hours" of the positive result),
  and it is not built yet (its formulary has no ACT). MAL-016 would join it if it counts only
  completed dispenses at facility level, as its feasibility row suggests.
- **Which do not.** RMNCAH-018, RMNCAH-021, NCD-009 and NCD-017 are built or proposed on the
  drug order, not the dispense, so the two instances agree on them.
- **How MAL-001 will differ.** The window is `resulted_at <= treated_at <= resulted_at + 24h`.
  For a child whose ACT was dispensed:
  - prescribed within 24 hours but handed over later: counted at central, not at the facility;
  - prescribed before the result was entered, and handed over after it within 24 hours: counted
    at the facility, not at central;
  - an order with no dispense, or a facility that does not use the dispensing app: the same at
    both.

  Central's MAL-001 therefore measures *prescribed* within 24 hours. The facility's measures
  *handed over* within 24 hours wherever pharmacists record dispenses. The report description
  must say which one a reader is looking at.
- **Checking.** `qa/reporting/compare-instances.py` skips MAL-001 by default for this reason
  (section 10).

## 8. Upgrading `mamba-core-api`

Core is a library inside the ETL OMOD, pinned by `mambaCoreVersion` in
`modules/mambaetl/pom.xml` (3.0.0). It is never in `distro.properties`. Use released versions
only.

1. **Read the new core's deploy path first.** In the new jar, compare
   `_core/compiler/linux/compile-mysql.sh` and `JdbcFlattenDatabaseDao` with the old ones. The
   build strips `SET GLOBAL event_scheduler = ON`. A new statement that needs SUPER, or a new
   `performance_schema` read, needs a flag or a grant (sections 3 and 4) before anything else.
2. **Bump `mambaCoreVersion`** and build: `mvn -f modules/mambaetl clean package` (it needs
   `bash`, `jq` and `rsync`). `finalize-jdbc-sql.sh` fails the build on a leftover `SET GLOBAL`,
   `DELIMITER` or `${var.`.
3. **Re-check every core override.** `modules/mambaetl/api/src/main/mamba/_etl/core_overrides/`
   replaces four core procedures with ours of the same name (ADR 0010 amendment A4). A changed
   upstream procedure is **silently replaced** by our copy, so compare each one between the old
   and the new core, and carry any upstream change into our copy. From the repository root,
   after the build has put the new jar in `~/.m2`:

   ```bash
   OLD=3.0.0 NEW=<new version>
   for v in "$OLD" "$NEW"; do
     mkdir -p "/tmp/mamba-core-$v"
     unzip -q -o ~/.m2/repository/org/openmrs/module/mamba-core-api/$v/mamba-core-api-$v.jar '_core/*' -d "/tmp/mamba-core-$v"
   done
   for f in modules/mambaetl/api/src/main/mamba/_etl/core_overrides/*.sql; do
     name="$(basename "$f")"
     old="$(find "/tmp/mamba-core-$OLD/_core" -name "$name")"
     new="$(find "/tmp/mamba-core-$NEW/_core" -name "$name")"
     if [ -z "$new" ]; then echo "GONE upstream: $name"
     elif diff -q "$old" "$new" >/dev/null; then echo "unchanged: $name"
     else echo "CHANGED upstream: $name"; diff -u "$old" "$new"; fi
   done
   ```

   `DeployScriptTest` then checks that each override is still the definition deployed.
4. **Run the module tests:** `mvn -f modules/mambaetl verify`, and
   `mvn -pl modules/liberiaemrreports/api,modules/liberiaemrreports/omod -am verify`.
5. **Run the stack check on a facility stack and on a central stack** (section 10). CI runs the
   facility check; run the central one by hand.
6. **Deploy.** The backend redeploys every routine on start. Existing tables stay, and the next
   run is incremental. Force a full rebuild (section 6) if the new core changed how any core
   table is built.

## 9. Adding an indicator, end to end

1. **The matrix.** Mark the row in `docs/reporting/feasibility/<file>.csv` *Feasible now* only
   once current content produces it, and fill `flat_table` and `report_uuid`
   (`docs/reporting/README.md` §1).
2. **The ETL table, if no existing one serves it.** Add
   `modules/mambaetl/api/src/main/mamba/_etl/derived/<area>/sp_mamba_fact_<area>_<name>.sql`,
   list it in your section of `_etl/sp_makefile`, and add its `CALL` to the same section of
   `_etl/sp_mamba_data_processing_etl.sql` (`modules/mambaetl/README.md`, "Adding configs and
   derived SQL"). Every UUID is a `${var.*}` token. Take `location_id` from
   `mamba_dim_encounter_location`, and count people by `person_key`. Never issue DDL on the ETL
   schema from an `openmrs` session.
3. **The report.** Add an `IndicatorQuery` to the sheet's manager in
   `modules/liberiaemrreports/api/src/main/java/org/openmrs/module/liberiaemrreports/reports/`
   (for example `MalariaReportManager.queries()`), with columns `<CODE>_NUM`, `_DEN` and `_PCT`
   (`docs/reporting/README.md` §3.3), `Sql.inPeriod(...)` on the event date and `g.inScope(...)`
   for the location. The SQL reads only `${etl}` tables. Add a line to `getNotes()` for anything
   it cannot count.
4. **The UI** needs nothing: it shows every column of the `indicators` data set.
5. **Tests.**
   - A unit test in the sheet's `*ReportManagerTest`, run as facility and as central, with
     `assertFacilityEqualsCentralForIt` and `assertByFacilityMatchesFacilityRuns`.
     `IndicatorContractTest` checks the column names and that the SQL reads only ETL tables.
   - Fixture rows for the indicator and its edge cases in `qa/reporting/fixtures/`, and its rows
     in `qa/reporting/expected-values.csv`, hand-counted, with a `reasoning`
     (`qa/reporting/README.md`). Several expected values count every patient in the fixtures,
     so a new patient changes other rows too.
   - `qa/reporting/load-fixtures.py lint`, then the stack check (section 10).
6. **Checks:** `scripts/validate/validate-content.sh`, which catches unresolved `${var.*}` and
   UUID literals in ETL and report sources, and `scripts/validate/no-secrets.sh`.
7. **Deploy.** The new routine is deployed on the next backend start, and a new table fills on
   the next run. A changed table that must apply to old rows needs a full rebuild (section 6).

## 10. Checking a stack

`qa/reporting/run-stack-check.sh` runs the ETL's definition of done from ADR 0010 against a
stack of synthetic data. **Run it only on a fresh throwaway stack:** it loads fixtures that
cannot be unloaded, and several expected values count every patient in the database.

It asserts, in order:

1. `setupEtl()` deployed as the ETL user: one definer on every routine and event, the backend's
   `mambaetl.analysis.db.username` names that user, the user has no global grant and no SUPER,
   and the MariaDB flags of section 3 are on;
2. a full run on the fixtures succeeds, with an empty `_mamba_etl_error_log`;
3. every row of `qa/reporting/expected-values.csv` for the instance matches, through
   `qa/reporting/compare-reports.py`: NUM, DEN and PCT of each indicator, per period and scope;
4. a late row added afterwards (`load-fixtures.py load-late-row`: a back-dated encounter with a
   weight, dated after both report periods) appears after one incremental run: in
   `mamba_dim_encounter`, where `mamba_etl_liberia_incremental_state` records it as a new key,
   in `mamba_fact_emr_ops_visit`, and in `mamba_fact_nutrition_anthropometry` with the obs's
   weight. The reports still match;
5. at a facility, no binlog event names `liberiaemr_etl`, while the fixtures' `openmrs.encounter`
   rows are there, which shows the binlog is on;
6. at central, after the full run, every `openmrs_identity.patient_link` row names a facility,
   the same Health Facility that `mamba_dim_location_hierarchy` attributes the record to, and
   never the County at the root of the scaffold. Counts only.

**Facility, as CI runs it** (`.github/workflows/ci.yml`, job *Initializer against a clean
database*), from the repository root:

```bash
scripts/build/build-distribution.sh --version 0.0.0-ci --site careysburg --no-frontend
REGISTRY=intellisoftdev qa/upgrade/run-clean-install.sh --version 0.0.0-ci --no-frontend --keep-stack
qa/reporting/run-stack-check.sh --role facility --site careysburg --dump-dir qa/reporting/.out -- \
  -f distribution/compose/facility/docker-compose.yml --env-file qa/upgrade/clean-install.env
docker compose -f distribution/compose/facility/docker-compose.yml \
  --env-file qa/upgrade/clean-install.env down -v
rm -rf qa/upgrade/clean-install.env qa/upgrade/.ci-certs
```

To run beside other stacks on one machine, give `run-clean-install.sh` a `--project-name`, and
pass the same `-p <project>` after the `--` and to the teardown.

**Central, by hand.** CI does not run it: central needs its own image and a second dictionary
import on a second runner. The check loads both sites straight into central's database, not
through sync, after creating both sites' locations and a County and District scaffold
(`load-fixtures.py prepare-central --admin-hierarchy`). It then waits for the identity task to
give every patient a CPI. The env file below holds throwaway values for a stack of synthetic
data only. Keep it in `qa/reporting/.out/`, which is not committed, and never beside a real env
file:

```bash
scripts/build/build-distribution.sh --version 0.0.0-ci --site central --no-frontend
mkdir -p qa/reporting/.out
cat > qa/reporting/.out/central.env <<'ENV'
REGISTRY=intellisoftdev
LIBERIAEMR_VERSION=0.0.0-ci
MYSQL_DATABASE=openmrs
MYSQL_USER=openmrs
MYSQL_PASSWORD=throwaway-openmrs
MYSQL_ROOT_PASSWORD=throwaway-root
ETL_DB_PASSWORD=throwaway-etl
OMRS_CREATE_TABLES=true
BACKEND_HEAP=3g
SYNC_MGMT_DB_PASSWORD=throwaway-mgmt
SYNC_REST_USER=unused
SYNC_REST_PASSWORD=unused
TLS_CERT_DIR=./unused-certs
ENV
central() { docker compose -p le-central -f distribution/compose/central/docker-compose.yml --env-file qa/reporting/.out/central.env "$@"; }
central up -d db backend
until central exec -T backend curl -fs http://localhost:8080/openmrs/health/started >/dev/null; do sleep 30; done
qa/reporting/run-stack-check.sh --role central --dump-dir qa/reporting/.out -- \
  -p le-central -f distribution/compose/central/docker-compose.yml --env-file qa/reporting/.out/central.env
central down -v
```

`SYNC_*` and `TLS_CERT_DIR` are only there because the compose file will not parse without
them; the check starts `db` and `backend` only.

**Facility equals central.** With both dumps written by `--dump-dir`, compare every column of
the `indicators` data set of every facility-scoped run: today NUM, DEN and PCT of each
indicator, and any disaggregation column a later report adds. The two stacks need not run at
the same time:

```bash
qa/reporting/compare-instances.py qa/reporting/.out/facility-careysburg.json qa/reporting/.out/central.json
```

EMR-OPS-007 and EMR-OPS-015 are skipped by default, because central has its own definition of
each. MAL-001 is skipped too: at a facility it uses the dispense time, which central does not
have (section 7). The fixtures hold no dispense, so to compare MAL-001 anyway, name the
exclusions yourself:
`--exclude EMR-OPS-007 --exclude EMR-OPS-015`. On 29 September 2026 the Careysburg facility and central scoped to Careysburg agreed on
all 84 compared cells (5 reports, 2 quarters), and differed only on the 12 skipped EMR-OPS-007
and EMR-OPS-015 cells, as expected. The indicators with look-back windows (MAL-004's 28-day
episodes, the 42-day delivery episodes of RMNCAH-026 and 028) are compared too: their windows
are scoped the same way at both instances.

## 11. The ETL schema is a full copy of patient data

`liberiaemr_etl` holds a flattened copy of the clinical record at every facility and at
central: names, addresses, identifiers, encounters, observations and orders. Treat it exactly
like `openmrs`:

- **Backups.** It is in the same MariaDB volume, so every database backup carries it, and
  backup encryption (control D3, [backup-restore.md](backup-restore.md)) must cover it. It is
  listed as a copy of clinical data at rest in [sync architecture](../architecture/sync-eip.md)
  §7.4. **Backup encryption is not yet implemented**, and that item blocks go-live. A backup may
  leave the schema out, because a full run rebuilds it from `openmrs`.
- **Access.** Only the ETL user and the OpenMRS user are granted on it (section 4). Do not grant
  it to analysts or to reporting tools; the reports expose aggregates only.
- **Not in the binlog.** At a facility, `--binlog-ignore-db` keeps it out of the binlog, so sync
  never ships it and the binlog's 99-day history never holds it.
- **Dropping it** (`DROP DATABASE liberiaemr_etl`, as root) loses nothing a full run cannot
  rebuild. The grants survive it, so the next backend start recreates the schema and its first
  run is a full one.

## Measurements

Measured on 29 September 2026 on one development machine: an Apple M5 laptop (10 cores,
24 GiB), with Docker 29.2.1 in a Colima VM of 4 vCPUs and 7.7 GiB, MariaDB 10.11.19, and images
built from `main` with the Careysburg site package (facility) or every site's locations
(central).

| What | Result |
| --- | --- |
| `performance_schema` cost, idle MariaDB with the facility's flags, `max_connections=151` | 177 MiB resident with `performance_schema` and its consumer on, 81.8 MiB with it off: **about 95 MiB**. `performance_schema` reports 93.9 MiB for itself. This matches ADR 0010 amendment A1 (175.8 against 80.75 MiB). |
| The same, on a facility and a central stack after the stack check | `performance_schema` reports 107.6 MiB for itself; the whole `db` container used 448 MiB (facility) and 458 MiB (central). |
| Central's first full build, on the fixtures | 113 patients, 148 encounters, 183 obs and a 4,655-concept dictionary: the full run took **1 s**, an incremental run 1 s, and the run `setupEtl()` starts on deploy 2 s. The ETL schema was 8.1 MiB beside 65.8 MiB of `openmrs`. |
| The facility's, on its 81 fixture patients | full run 1 s, incremental run 1 s. |
| The stack check (section 10) | facility 48 s end to end, of which 44 s are the two report comparisons (10 report runs each); central 326 s, of which 62 s waiting for CPIs and about 130 s for each comparison (60 report runs each). |
| Clean install to a started backend | about 8 minutes for the facility, about 17 minutes for central, most of it the dictionary import. |

**On a first boot the ETL's first run can start before the dictionary import has finished**
(at central it ran 16 minutes before the backend answered its health check). That run
flattens only part of the dictionary; the next incremental run's sweep fills in the rest. Force
a full rebuild (section 6) after the first boot if the reports are needed before the second run.

**Not measured:**

- **Central's first full build at national volume.** No realistic national dataset exists
  outside production, and 113 synthetic patients say nothing about hours at scale. The central
  interval (3600 s), central's `BACKEND_HEAP` and its database sizing therefore stay
  provisional (ADR 0010 decision 4). Measure the first full run on the central server, from
  `_mamba_etl_schedule.execution_duration_seconds`, before go-live.
- **Anything on facility-class hardware.** No run was made on the machines facilities will use,
  so neither the `performance_schema` cost against their memory nor the run times are known
  there. The 95 MiB figure does not depend on data volume.
- **The facility interval (1800 s)** against a real facility's incremental run time.
- **Memory and CPU during a large ETL run.**
