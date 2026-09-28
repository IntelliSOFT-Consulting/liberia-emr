# mamba-etl-liberiaemr

This module builds the local reporting schema, `liberiaemr_etl`, that the indicator reports
read. Every instance, facility and central, runs it against its own `openmrs` database. The
ETL schema is never synced. Decisions are in
[ADR 0010](../../docs/adr/0010-indicator-reporting-mamba-etl.md), and the conventions for
configs and derived SQL are in [docs/reporting/README.md §2](../../docs/reporting/README.md).

- **Core.** [MambaETL](https://github.com/openmrs/openmrs-module-mamba-core)
  `mamba-core-api` 3.0.0 is bundled in the OMOD's `lib/`. It is a library, so it is never
  added to `distro.properties`.
- **Start and stop.** The activator calls `FlattenDatabaseService.setupEtl()` on start. Core
  then deploys `mamba/jdbc_create_stored_procedures.sql` on a thread of its own, **as the
  ETL database user**, and schedules the ETL as a MariaDB event. A failed deploy is only
  logged, as `Failed to deploy MambaETL`; OpenMRS keeps starting.
- **Image.** `distribution/backend/Dockerfile` builds the module from source, like
  `modules/liberiaemr`. It is not published anywhere.

## Layout

```
api/src/main/mamba/_etl/
├── config/<form>.json                 flat-table configs (one per encounter type); empty for now
├── derived/<area>/sp_*.sql            derived dimensions and facts
├── sp_makefile                        lists every derived SP, in per-owner sections
└── sp_mamba_data_processing_etl.sql   the caller: CALLs them in the same order
api/src/main/sh/finalize-jdbc-sql.sh   post-processes and checks the compiled script
```

## Build

```bash
mvn -f modules/mambaetl clean package     # needs bash, jq and rsync on PATH
```

All of it runs inside the **api** module's `package`, so the jar always ships SQL compiled
from the same commit. Nothing generated is committed.

1. Wipe `api/target/mamba-etl` and unpack core's `_core/**` into it.
2. Copy `_etl` into it, **filtering `${var.*}`** from the `variables.properties` of common,
   national, mch, lab, pharmacy and opd-ipd, in that order. Site packages,
   `content-central` and `content-demo` are not in the chain.
3. Run core's `compile.sh -n mysql`.
4. Run `finalize-jdbc-sql.sh`, which drops `SET GLOBAL event_scheduler = ON` (it needs SUPER)
   and fails the build if the script still has a `${var.`, a `SET GLOBAL` or a `DELIMITER`,
   or lacks any procedure `sp_makefile` lists.

`DeployScriptTest` checks the script the jar ships. Compiler noise such as
`cat: …/config/*.json: No such file or directory` is expected while `config/` is empty.

## Adding configs and derived SQL

- **Flat table.** Add `config/<form>.json` as §2.2 describes. Use `${var.*}` tokens only;
  the build fails on one that no layer declares.
- **Derived table.** Add `derived/<area>/sp_mamba_fact_<area>_<name>.sql`. Put the body
  between `-- $BEGIN` and `-- $END` lines. The compiler wraps it in
  `CREATE PROCEDURE sp_mamba_fact_<area>_<name>()` with core's error handler, so the body cannot
  `DECLARE`; use `@session` variables or a nested `BEGIN … END`. Qualify source tables as
  `mamba_source_db.<table>`; ETL tables need no qualifier. Then list the file in **your own
  section** of `sp_makefile`, and add its `CALL` to the same section of
  `sp_mamba_data_processing_etl.sql`. Take `location_id` from `mamba_dim_encounter_location`
  and `facility_location_id` from `mamba_dim_location_hierarchy`.
- **Never** write DDL that targets the ETL schema from an `openmrs`-context session. The
  facility binlog filters on the default database.

## Running it locally

Compose sets the runtime properties as `OMRS_EXTRA_MAMBAETL_ANALYSIS_*` on the backend
(ADR 0010 decision 4). The `db` service's initdb creates the ETL user when `ETL_DB_PASSWORD`
is set.

**The full way.** Run `scripts/build/build-distribution.sh`, then start the stack.

**A quicker loop.** Layer a freshly built OMOD over an existing backend image. The layer
must replace the image's copy **under the same file name**: startup copies
`/openmrs/distribution/openmrs_modules/` into the data volume, and it does not remove an OMOD
dropped there by hand. Use a two-line Dockerfile:

```dockerfile
FROM <registry>/liberia-emr-backend:<version>
COPY mamba-etl-liberiaemr-<version>.omod /openmrs/distribution/openmrs_modules/
```

Tag it as the image the compose file names, set `ETL_INTERVAL_SECONDS=120` in the env file,
and run `docker compose … up -d db backend`. The first boot of an empty database needs
`OMRS_CREATE_TABLES=true`. A restart redeploys every routine, and the redeploy is
idempotent. Then query:

```bash
docker exec <db> mariadb -uroot -p… liberiaemr_etl -e "
  SELECT * FROM _mamba_etl_error_log;
  SELECT id, start_time, end_time, completion_status, transaction_status, success_or_error_message
    FROM _mamba_etl_schedule ORDER BY id DESC LIMIT 5;"
```

To run once without waiting, call `CALL sp_mamba_etl_schedule();` as the ETL user in
`liberiaemr_etl`. Do not run it as root: routines and events must keep the ETL user as
definer.

The first run is a full drop-and-flatten, and later ones are incremental. Every run calls
`sp_mamba_data_processing_etl(mode)` last.

**Reading `_mamba_etl_schedule`.** On each tick, core's `sp_mamba_etl_un_stuck_scheduler`
rewrites the previous row if it ended in `ERROR` or was left `RUNNING`. It sets
`completion_status` to `SUCCESS`, `success_or_error_message` to `Error schedule updated` or
`Stuck schedule updated`, and resets both times. A genuine success is therefore a row with
`transaction_status = 'COMPLETED'`, `completion_status = 'SUCCESS'`,
`success_or_error_message IS NULL` and a non-null `end_time`. `_mamba_etl_error_log` is the
lasting record of failures.
