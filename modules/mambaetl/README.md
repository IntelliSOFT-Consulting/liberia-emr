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

## RMNCAH and nutrition tables

These come from the `rmncah` and `nutrition` sections. Each procedure rebuilds its table in
full on every run. Every table carries `client_id`, `person_key` (from
`mamba_dim_person_cpi`; count people with `COUNT(DISTINCT person_key)`), `location_id` (from
`mamba_dim_encounter_location`) and `facility_location_id`. Voided encounters and voided obs
never appear. Each file's header comment explains its columns and the indicator rule that
reads them.

| Table | Grain | Serves |
| --- | --- | --- |
| `mamba_fact_rmncah_anc_visit` | one ANC contact, from both form families | MAL-002, MAL-003, MAL-011; later RMNCAH-016 |
| `mamba_fact_rmncah_family_planning` | one encounter on any version of `3. Family Planning` | RMNCAH-017 |
| `mamba_fact_rmncah_delivery` | one L&D encounter (First and Second Stage, Third Stage), with 42-day delivery episodes | RMNCAH-026; later RMNCAH-014, 016, 027 |
| `mamba_fact_rmncah_mother_pnc` | one Mother PNC encounter, with 42-day delivery episodes | RMNCAH-028 |
| `mamba_fact_nutrition_anthropometry` | one Triage, Vitals or OPD encounter with weight, height or MUAC; WHZ computed here | NUT-008, NUT-009; the NCD-008 BMI proxy |
| `mamba_fact_nutrition_vitamin_a` | one Vitamin A dose, from the Immunization form or a drug order | NUT-005 |
| `mamba_dim_nutrition_who_wflh` | WHO 2006 weight-for-length/height LMS reference, 2404 rows, seeded by the ETL | WHZ |

### The ANC/IPTp contract (`mamba_fact_rmncah_anc_visit`)

RPT 6 owns this table, and the malaria facts read it rather than rebuilding it. Columns are
only ever added, never renamed or dropped.

| Column | Type | Meaning |
| --- | --- | --- |
| `encounter_id` | INT, PK | the ANC contact |
| `visit_id`, `client_id`, `person_key` | | as above |
| `encounter_datetime` | DATETIME | the contact's time; compare periods against it |
| `location_id`, `facility_location_id` | INT | attribution |
| `encounter_type_uuid`, `form_uuid` | CHAR(38) | where the contact came from |
| `anc_form_family` | `'mch'` / `'national'` | ANC Initial or Follow-up, or `1. ANC Form` |
| `is_first_anc_contact` | 0/1 | an ANC Initial Visit, or national ANC visit number = 1st (MAL-002 denominator) |
| `anc_visit_number` | 1–4 or NULL | the national form's ANC visit number |
| `gestational_age_weeks` | DECIMAL or NULL | CIEL 1438, or the local follow-up concept |
| `trimester` | 1–3 or NULL | Pregnancy trimester (CIEL 5272) |
| `is_third_trimester` | 0/1 | `trimester = 3` or `gestational_age_weeks >= 28` (MAL-003 denominator) |
| `iptp_dose_number` | 1–4 or NULL | the highest IPTp dose given at the contact. The national question's 3rd answer means "3rd or later" and is stored as 3 |
| `woman_receiving_ipt` | 1 / 0 / NULL | Woman receiving IPT, yes or no |
| `iptp_deferral_reason_uuid`, `iptp_deferred` | CHAR(38), 0/1 | the MCH deferral reason, if one is given |
| `llin_received` | 1 / 0 / NULL | LLIN received at ANC (MAL-011) |

The fixtures' readings are then:

- MAL-002: the numerator is people with `iptp_dose_number >= 3` in the period, and the
  denominator is people with `is_first_anc_contact = 1` in the period.
- MAL-003: the denominator is people with `is_third_trimester = 1` in the period, and the
  numerator is those of them with `iptp_dose_number >= 2` on such a contact.

### Interim form matches

Three forms have no variable that holds their runtime uuid (rmncah-nutrition gaps note, gap
11). Until they do, the SQL matches them on `form.name` **and** `form.version`, and each
place is marked `INTERIM` in the SQL:

- `1. ANC Form` v1.1 in `sp_mamba_fact_rmncah_anc_visit`;
- `3. Family Planning` v1.0 in `sp_mamba_fact_rmncah_family_planning`;
- `OPD Consultation Form` v2.0 in `sp_mamba_fact_nutrition_anthropometry`.

The Triage form needs no match, because Triage is its own encounter type.

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
