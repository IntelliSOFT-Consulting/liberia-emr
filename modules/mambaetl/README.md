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
├── core_overrides/sp_*.sql            same-named replacements for core procedures (LE-363)
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

## Incremental runs and late-arriving rows (LE-363)

**LE-363 changes:** incremental runs now find new core-dimension rows by key (with a daily
sweep) and modified ones by value, not by timestamp. No full rebuild is scheduled. The ADR 0010
amendment (LE-362) is to record this choice.

Core's incremental mode refreshes each `mamba_dim_*` table, and `mamba_z_encounter_obs`,
through `sp_mamba_etl_incremental_columns_index(<openmrs table>, <etl table>)`. That call
copies the source table's key and change columns into `mamba_etl_incremental_columns_index_all`,
then lists the **new** keys (`…_index_new_insert`) and the **modified** keys
(`…_index_modified_insert`) for the table's own insert and update procedures. Core 3.0.0 lists
them by timestamp: new when `date_created`, and modified when `date_changed`, `date_voided` or
`date_retired`, is at or after the start of the last completed run. dbsync keeps a facility's
original timestamps, so at central a record, a void or an edit that syncs after a run started
was never flattened. Back-dated data behaves the same way at a facility.

`core_overrides/` replaces four core procedures. They are compiled after core's copies, so
theirs are the definitions deployed; `DeployScriptTest` fails the build if that stops being
true.

| Procedure | Change |
| --- | --- |
| `sp_mamba_etl_incremental_columns_index_new_insert` | A key is new when it is not in the ETL table and it is above the highest key the table saw on its previous run, less a margin of 10 000. Core's `date_created` test is kept as well. Once a day per table, and on the first incremental run after a full one, a **sweep** drops the key bound, so nothing the margin missed stays out longer than a day. State is kept in `mamba_etl_liberia_incremental_state`. |
| `sp_mamba_etl_incremental_columns_index_modified_insert` | Core's timestamp test is kept, and a row is also modified when any of `date_changed`, `voided`, `date_voided`, `retired` or `date_retired` differs between the source and the ETL table. Only the columns the ETL table has are compared. |
| `sp_mamba_dim_patient_identifier_incremental_update` | Core's copy joins the modified `patient_identifier_id` keys to `patient_id`, so it rewrote the wrong patient's identifiers. It now joins on `patient_identifier_id`. |
| `sp_mamba_dim_encounter_insert` (full runs) | Core's copy keeps only encounter types that have a flat table, so with no configs a full run left `mamba_dim_encounter` empty; its incremental insert keeps every type. Both modes now keep every encounter of a known type. |

`mamba_etl_liberia_incremental_state` shows what the last run did for each table:
`max_pkey_seen`, `last_sweep_time`, `last_run_sweep` and `last_run_new`, the number of keys
listed as new. A full run drops it along with every other `mamba_*` table.

**Cost.** Core already copies each source table's key and change columns into
`…_index_all` on every incremental run. The overrides add two primary-key joins of that copy
against the ETL table: an anti-join for new rows, and a join over the stored change columns for
modified ones. Between sweeps, only keys above the bound are examined. In a sweep, every
source row that the table's insert procedure filters out is examined again and is still not
inserted. Examples are obs of concepts that no flat table uses, and concept names in other
locales. For `obs` at central, that is the largest cost, and it is paid once a day.

**Not in scope.** Rows deleted outright in the source stay in the ETL tables, as in core;
OpenMRS voids rather than deletes. `mamba_obs_group` is only built by a full run, as in core.

**A full rebuild** is still available, and is the recovery path after a restore or a bulk
correction. Set `incremental_mode_switch = 0` in `_mamba_etl_user_settings` as the ETL user,
let one run complete, then set it back to `1`. The next backend start rewrites the setting
from `mambaetl.analysis.incremental_mode` anyway. A full run drops every `mamba_*` table
first, so reports read empty tables until it completes. That is why no rebuild is scheduled.

**Reading `_mamba_etl_schedule`.** On each tick, core's `sp_mamba_etl_un_stuck_scheduler`
rewrites the previous row if it ended in `ERROR` or was left `RUNNING`. It sets
`completion_status` to `SUCCESS`, `success_or_error_message` to `Error schedule updated` or
`Stuck schedule updated`, and resets both times. A genuine success is therefore a row with
`transaction_status = 'COMPLETED'`, `completion_status = 'SUCCESS'`,
`success_or_error_message IS NULL` and a non-null `end_time`. `_mamba_etl_error_log` is the
lasting record of failures.
