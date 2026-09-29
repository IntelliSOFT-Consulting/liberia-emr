# 0010: Indicator reporting on a per-instance Mamba ETL schema, with an in-tree reports module

**Status:** Proposed. Every decision is built and merged, and the builds changed some of them;
see [Amendment (2026-09)](#amendment-2026-09-what-building-and-verifying-found).
**Date:** 27 September 2026 · **Amended:** 29 September 2026 (LE-362) · **Ticket:** LE-330
(parent: *Indicator reports*)

> **Read with the amendment.** The Context and Decision sections below were written before the
> modules existed, and they are kept as the record of that reasoning. Where the builds changed a
> decision, the amendment says so, and a marker *(amended: A*n*)* points to it from the text.

## Context

The MOH indicator workbook (RMNCAH, Nutrition, Malaria, NCD, EMR-Ops; 100 indicators) is to
be produced from LiberiaEMR data. The reports must run on flat ETL tables, not on ad-hoc
queries against the OpenMRS EAV schema. They must also run the same way at every facility
and at central.

What the repository already fixes:

- **One backend image.** It is built by `distribution/backend/Dockerfile`. The in-tree
  `modules/liberiaemr` OMOD is built in the `module` stage from the tag's own source
  (Dockerfile lines 95–133) and is deliberately absent from `omod.*` (`distribution/distro.properties`
  lines 245–259).
- **`reporting` and `reportingrest` are pinned:** `omod.reporting=2.1.0` and
  `omod.reportingrest=2.0.0` (`distro.properties` lines 68–69).
- **Both stacks run MariaDB 10.11.** Only the facility has a binlog: ROW format, about
  99 days' retention, `sync-binlog=1` (`distribution/compose/facility/docker-compose.yml`
  lines 21–30). Central's `db` has none (`distribution/compose/central/docker-compose.yml`
  lines 13–16).
- **dbsync watches an explicit table list** in `openmrs`
  (`distribution/sync/application.properties.template` line 20).
- **Locations are metadata and are never synced.** Central gets them from the image and from
  the MFL sync (ADR 0009, on its own branch). Central is built with one `SITE_PACKAGE`
  (Dockerfile line 28).
- **`Export National Report` exists.** It is defined in `privileges-national.csv` line 3 and
  granted to *National Reporting Officer* in `roles-national.csv` line 3.
- **`CONTRIBUTING.md` line 160 forbids hard-coded UUIDs** in forms, reports or frontend JSON.
  Content declares UUIDs once, in `variables.properties`. `content-packages/pom.xml` resolves
  them by Maven resource filtering (execution `filter-configuration`, line 127, delimiter
  `${*}` only).

Reference implementations read: eHospital 2.0 (`distro/distro.properties`,
`runtime-properties-config`), `openmrs-module-mamba-etl-ehospital`,
`openmrs-module-ehospitalreports` and `openmrs-module-botswanaemr` (`MambaEtlSchema.java`,
`docs/deployment/RUNTIME_PROPERTIES_ENV.md`).

Evidence gathered for this ADR:

- the `mamba-core-api` 3.0.0 and 2.0.0 jars and poms (SHA-1 of the 3.0.0 jar is
  `4e1005f3a1957352f5ea8e72dc38e2e134f78ca8`, which matches the repository's `.sha1`);
- the `reportingrest-omod` 2.0.0 sources jar;
- `startup-init.sh` from `openmrs/openmrs-core:2.8.8`;
- a throwaway `mariadb:10.11` (10.11.18) started with the facility's binlog flags, used to
  exercise the grants below.

## Decision

### 0. Deployment model (decided 27 September 2026, recorded as given)

**Every instance runs its own local, independent ETL database and reporting modules. ETL
databases are never synced.**

- **Facilities** build an ETL schema from their own `openmrs` database and report on
  themselves.
- **Central** builds its own ETL schema from its dbsync-populated `openmrs` database. It
  reports on any MFL node, national totals included.
- **Nothing moves between instances:** no ETL tables, routines or report results.
- **The image and the definitions are identical everywhere.** Only runtime properties differ.
- **Events are attributed by encounter/visit location.**

### 1. Mamba packaging: `modules/mambaetl`, artifactId `mamba-etl-liberiaemr`, core 3.0.0 bundled

`modules/mambaetl` is an api + omod module modelled on `mamba-etl-ehospital`. The
Dockerfile builds it the way it builds `liberiaemr`, and it is **not** listed in `omod.*`.

- **Core is a library, not a module.** It depends on `org.openmrs.module:mamba-core-api`,
  compile scope, bundled in the OMOD's `lib/`. Core is **never pinned in
  `distro.properties`**.
- **Module package.** The module's `<package>` must not be `org.openmrs.module.mambaetl`,
  which an upstream `mamba-etl` module could also claim.
- **The activator** calls `FlattenDatabaseService.setupEtl()` in `started()` and
  `shutdownEtlThread()` in `stopped()`, as the reference does.

**Pin `mamba-core-api` 3.0.0.** Released versions on `mavenrepo.openmrs.org` are **2.0.0 and
3.0.0**; 1.0.1-SNAPSHOT and 2.0.1-SNAPSHOT are snapshots. The repository metadata was last
updated on 17 September 2026. Reasons for 3.0.0:

- **Platform.** 3.0.0 is built against OpenMRS **2.8.0** (`mamba-core` parent pom,
  `openmrsPlatformVersion`; `config.xml` `require_version` 2.8.0). That is the closest to our
  2.8.8. 2.0.0 is built against 2.0.0.
- **Bytecode.** Both are Java 8 (class major version 52). The runtime image's JVM is Corretto
  17.0.19.
- **Schema-agnostic deploy script.** The deployable script, `mamba/jdbc_create_stored_procedures.sql`,
  carries the placeholders `mamba_source_db` and `mamba_etl_db`, and Java replaces them at
  runtime from `mambaetl.analysis.db.openmrs_database` and `mambaetl.analysis.db.etl_database`
  (`JdbcFlattenDatabaseDao.executeSqlScript`; `compile-mysql.sh` writes the `jdbc_` file
  "before replacing mamba_source_db placeholder cuz this is replaced in Java"). **One build
  therefore serves any ETL schema name.** That is what "identical image, different runtime
  properties" needs.
- **Other 3.0.0 additions:**
  - it creates the ETL database with the source database's charset and collation;
  - it preflights a script for `DELIMITER` directives;
  - it has an optional external-directory deploy (`mambaetl.analysis.etl_directory`), which we
    leave unset.

**Upgrades.** Change `mambaCoreVersion` in `modules/mambaetl/pom.xml` to another *released*
version, rebuild, then rerun the QA gate described in the Consequences on a facility stack and
on a central stack. Read the new jar's `JdbcFlattenDatabaseDao` and `compile-mysql.sh` for
changes to the deploy statements first: decision 3 depends on them.

**Not verified: whether `setupEtl()` runs cleanly on core 2.8.8.** *(Amended: since run on
facility and central stacks by the builds the amendment lists; A1 and A5 record what that
found.)* That needs a running
stack, which is the first acceptance check of the scaffold subtask. The static evidence says it
should:

- it was built against the 2.8.0 API;
- it reads its settings from `Context.getRuntimeProperties()`;
- its database work is plain JDBC on its own `commons-dbcp2` pool, initial 4 connections and
  maximum 20.

**The OMOD must be `aware_of` `webservices.rest`,** as the reference is. Core's Spring context
component-scans a REST controller that extends `MainResourceController`.

**Do not bundle a JDBC driver.** The reference declares `mysql-connector-j` 9.0.0 compile;
we omit it. The connection uses `connection.driver_class` from the core image.

**Mamba's own REST surface stays unused.** Core component-scans a resource at `/ws/rest/v1/mamba/report`
(`MambaReportResource`), guarded by `View MambaReport`. That privilege is declared only in core's own
`config.xml`, which is never loaded when core is bundled. We ship no `reports.json` and
create no such privilege; reports go through reportingrest (decision 6). *(Amended: A7; the
UI also reads one `liberiaemrreports` endpoint.)*

### 2. Build pipeline: one `package` produces current SQL, and nothing generated is committed

**What the reference does** (confirmed in `openmrs-module-mamba-etl-ehospital/pom.xml`,
bound in the omod module):

- **prepare-package:** `dependency:unpack` of `_core/**` to `target/mamba-etl`, a filtered
  copy of `src/main/resources/_etl`, and `chmod`;
- **package:** `exec` of `compile.sh -d openmrs -a ehospital_etl -s ../../database/mysql/sp_makefile -t …/_etl/config -n mysql -b 1`;
- **install:** a copy of `_core/database/mysql/build` into **`api/src/main/resources/mamba`**,
  a source directory. `mamba_main.sql` there is git-tracked.

**Two defects follow.** The api jar is built *before* the omod module in the reactor, so
even `mvn install` ships the SQL from the *previous* build. Our Dockerfile runs `clean package`
(line 125), so the copy never runs at all. A 3.0.0 build would also need the `jdbc_` file,
which the reference never copies.

**The fix is to run the chain inside `modules/mambaetl/api`, before `package`** *(amended:
the phases as built are in A6)*:

| Phase | Step |
| --- | --- |
| `initialize` | delete `target/mamba-etl`; `dependency:unpack` `mamba-core-api:3.0.0` `_core/**` into it (`overWrite` true) |
| `process-resources` | `resources:copy-resources` `src/main/mamba/_etl/**` → `target/mamba-etl/_etl`, **filtered** with the content `variables.properties` (decision 7) |
| `process-resources` | `exec` `bash compile.sh -n mysql -d openmrs -a liberiaemr_etl -s ../../database/mysql/sp_makefile -t ${project.build.directory}/mamba-etl/_etl/config -b 1` in `_core/compiler/linux` |
| `process-classes` | copy `build/jdbc_create_stored_procedures.sql` → `target/classes/mamba/`, **removing the `SET GLOBAL event_scheduler = ON;` statement** (decision 3) |
| `process-classes` | fail the build if that file is missing or empty, or contains `${var.`, `SET GLOBAL` or `DELIMITER` |

- **Result.** The api jar then carries SQL compiled from the same commit, and nothing
  generated is written under `src/` or committed. The `-d`/`-a` arguments only name the
  mysql-client and Liquibase outputs, which we do not ship.
- **Why `initialize` deletes first.** `compile-base.sh` *appends* to the unpacked core
  `sp_makefile`, and `dependency:unpack` skips on its marker file. A non-clean rebuild would
  otherwise accumulate duplicate entries.
- **Rejected: commit the generated SQL with a CI staleness check.** That generated file is
  thousands of lines that reviewers cannot read. It also adds a second source of truth and a
  check whose only job is to catch the drift it creates.

**What the build needs.** Verified in the cached `maven:3.9-eclipse-temurin-17` image
(Ubuntu 24.04):

- `compile-base.sh` requires `bash` and `jq`, and `compile-mysql.sh` also uses `rsync`,
  `readlink -f`, `awk`, `sed`, `find` and `mktemp`;
- the image has `bash`, `readlink`, `awk` and `find`, **but not `jq` or `rsync`**. The Dockerfile
  stage must `apt-get install -y --no-install-recommends jq rsync`;
- GitHub's Ubuntu runners have both, so `.github/workflows/modules.yml` needs only the new
  module paths;
- `compile.sh` also supports only `-n mysql`; postgres, sqlserver and oracle are
  commented out in `compile-base.sh`. Nothing in it targets MariaDB specifically. The
  compatibility evidence is under decision 3.

**The Dockerfile's `module` stage builds all three in-tree modules.** They are `liberiaemr`,
`mambaetl` and `liberiaemrreports`, each stamped with `LIBERIAEMR_VERSION` and each subject to
the existing no-SNAPSHOT check. The stage must also `COPY content-packages/*/configuration/variables.properties`,
which are the filter inputs for decision 7.

### 3. MariaDB 10.11, binlog and grants

**MariaDB compatibility of core 3.0.0's SQL** (242 SQL files, scanned):

- **None of these constructs appear:** `->`/`->>`, `CAST(… AS JSON)`, `MEMBER OF`,
  `JSON_TABLE`, `JSON_ARRAYAGG`, `JSON_OBJECTAGG`, `REGEXP_LIKE`, `ANY_VALUE`,
  `utf8mb4_0900_*`, window functions, CTEs, `DEFINER` and `SET PERSIST`.
- **These JSON functions are called:** `JSON_EXTRACT` (35 calls), `JSON_UNQUOTE` (22),
  `JSON_LENGTH` (8) and `JSON_KEYS` (1). Core's own `fn_mamba_json_*` helpers wrap the rest. All
  four returned the expected results on 10.11.18 against a config-shaped document.
- **Other syntax, all documented as supported by MariaDB 10.11:**
  - `ON DUPLICATE KEY UPDATE … VALUES(col)`, exercised in the test;
  - `CREATE EVENT`, exercised in the test;
  - `CREATE TEMPORARY TABLE IF NOT EXISTS`, not exercised;
  - `GET DIAGNOSTICS`, not exercised.
- **Routine syntax.** All 19 `CREATE FUNCTION`s declare `DETERMINISTIC`, and one of them
  also declares `NO SQL`. None sets a `DEFINER`.

Compatibility is not *proven* until the whole script runs on a clean facility stack and a
clean central stack, with an empty `_mamba_etl_error_log`.

**Three of four statements need more than schema-level rights.** Tested as a user holding only `ALL ON
liberiaemr_etl.*` and `SELECT ON openmrs.*`, with the facility's binlog flags:

| Statement (from core 3.0.0) | Result | Resolution |
| --- | --- | --- |
| `CREATE PROCEDURE …` then `CALL` (DDL + DML into the ETL schema) | works | none needed |
| `CREATE FUNCTION … DETERMINISTIC` | **ERROR 1419**: "You do not have the SUPER privilege and binary logging is enabled" | facility: `--log-bin-trust-function-creators=1` |
| `SET GLOBAL event_scheduler = ON` (in the deploy script) | **ERROR 1227**: needs SUPER | `--event-scheduler=ON` on **both** stacks, and the statement is stripped at build time (decision 2) |
| `SELECT … FROM performance_schema.events_statements_current` (`sp_mamba_etl_un_stuck_scheduler`, **called on every scheduled run**) | **ERROR 1142** | `GRANT SELECT ON performance_schema.events_statements_current`, and `--performance-schema=ON` on both stacks |

- **`SET GLOBAL` would stop every stack.** Without the strip, `setupEtl()` aborts on that
  statement for *any* non-SUPER user, **including today's OpenMRS user**.
- **`performance_schema` protects against overlapping runs** *(amended: A1; the flag alone is
  not enough)*. With `performance_schema=OFF`
  (the MariaDB default), the granted table is readable but returns 0 rows, even while a
  statement is running. Both were confirmed. The un-stuck check then marks a genuinely running
  ETL as finished, and the next event can start an overlapping run.
- **The flags were tested together.** A second test server ran
  `--log-bin-trust-function-creators=1 --event-scheduler=ON --binlog-ignore-db=liberiaemr_etl`.
  There, the ETL user created a `DETERMINISTIC` function without SUPER. An event it created
  ran every second, reading `openmrs` and writing the ETL schema. After a `FLUSH BINARY LOGS`,
  the new binlog held no event at all.
- **Why not SUPER.** `log_bin_trust_function_creators=1` is preferred over granting SUPER on
  grounds of least privilege (control B2, `docs/security/moh-ict-sop-mapping.md`). The unsafe
  case it guards against is a non-deterministic function replayed *statement-based* on a
  replica. The facility binlog is ROW format, and its only consumer is Debezium, which reads
  row events. The one principal that creates routines is the ETL user. SUPER would instead
  hand an application credential server-wide control.

**Binlog: `--binlog-ignore-db=liberiaemr_etl` at facilities.** Tested with ROW format:

- **filtered:** row events for ETL tables are filtered whatever the default database. None of
  these were logged either:
  - DDL and DML inside ETL-schema routines;
  - `CREATE EVENT`, and the event's own runs;
  - `CREATE DATABASE IF NOT EXISTS liberiaemr_etl`, issued from the `openmrs` context;
- **still logged:** DDL on an ETL table issued while the default database was `openmrs`.

Core 3.0.0's deploy script creates the database and then runs `USE mamba_etl_db`
(`compile-mysql.sh`, `use_target_db`), so everything after it runs in the ETL context. Rule
for our own derived SQL: **no ETL-schema DDL from an `openmrs`-context connection.**

**dbsync is unaffected, for three reasons:**

- dbsync processes only `eip.watchedTables`, which are all `openmrs` tables;
- the ETL user reads `openmrs` and never writes it: `INSERT` was refused in the test, and no
  core SQL writes `mamba_source_db`;
- the filter also keeps ETL DDL out of Debezium's schema-history parser.

`binlog-ignore-db` and `log-bin-trust-function-creators` apply to **facilities only**.
Central has no binlog. If central ever enables one, both flags apply there too.

**Grants.** A dedicated ETL user on both stacks, created by a new initdb script: facility
`20-etl-db-user.sh`, central `30-etl-db-user.sh` *(amended: A2)*.

```sql
CREATE DATABASE IF NOT EXISTS `liberiaemr_etl` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '<ETL_DB_USER>'@'%' IDENTIFIED BY '<ETL_DB_PASSWORD>';
GRANT ALL PRIVILEGES ON `liberiaemr_etl`.* TO '<ETL_DB_USER>'@'%';
GRANT SELECT ON `openmrs`.* TO '<ETL_DB_USER>'@'%';
GRANT SELECT ON `performance_schema`.`events_statements_current` TO '<ETL_DB_USER>'@'%';
-- liberiaemrreports queries the ETL schema over the OpenMRS connection:
GRANT SELECT ON `liberiaemr_etl`.* TO '<MARIADB_USER>'@'%';
```

- **The OpenMRS-user fallback is rejected.** Core falls back to `connection.username` only
  when the property is *absent*. The compose files always set the variable, and an empty
  value becomes an empty username. The fallback user also holds `ALL` on `openmrs`, so ETL
  code could write clinical tables.
- **Residual risk.** `SELECT ON openmrs.*` includes `users.password`/`salt`. The OpenMRS
  credential already reaches them, and the ETL credential lives in the same container
  environment. Narrow the grant to table level only if MOH ICT asks: every new source table
  would then be a grant change.
- **Existing databases.** initdb runs once, so on an existing database the runbook runs these
  statements by hand. The server flags take effect when the `db` container restarts.

### 4. Per-instance runtime configuration

These are set as `OMRS_EXTRA_*` variables on the `backend` service. `startup-init.sh` in
`openmrs-core:2.8.8` maps `OMRS_EXTRA_A_B__C` to `a.b_c` (strip the prefix, lowercase,
`_`→`.`, `..`→`_`). On an existing volume it merges them into the persisted
`openmrs-runtime.properties`, **with the environment first**, so a changed value applies on
restart. A variable that is *removed* leaves its last value in the file.

| Runtime property | Variable | Facility | Central |
| --- | --- | --- | --- |
| `mambaetl.analysis.db.openmrs_database` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_OPENMRS__DATABASE` | `${MYSQL_DATABASE}` | `${MYSQL_DATABASE}` |
| `mambaetl.analysis.db.etl_database` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_ETL__DATABASE` | `liberiaemr_etl` | `liberiaemr_etl` |
| `mambaetl.analysis.db.username` / `.password` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_USERNAME` / `_PASSWORD` | `${ETL_DB_USER}` / `${ETL_DB_PASSWORD}` | same |
| `mambaetl.analysis.locale` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_LOCALE` | `en` | `en` |
| `mambaetl.analysis.columns` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_COLUMNS` | `40` (core default) | `40` |
| `mambaetl.analysis.incremental_mode` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_INCREMENTAL__MODE` | `1` | `1` |
| `mambaetl.analysis.automated_flattening` | `OMRS_EXTRA_MAMBAETL_ANALYSIS_AUTOMATED__FLATTENING` | `0` | `0` |
| `mambaetl.analysis.etl_interval` (seconds) | `OMRS_EXTRA_MAMBAETL_ANALYSIS_ETL__INTERVAL` | `1800` | `3600` |

- **Where the defaults live.** They go in `distribution/compose/{facility,central}/docker-compose.yml`
  as `${VAR:-default}`, with placeholders in `distribution/env/*.env.example`.
  `ETL_DB_PASSWORD` is `CHANGE_ME` in the templates and never committed. Core reads it only
  from runtime properties, so it lands in `/openmrs/data/openmrs-runtime.properties`, beside
  `connection.password`.
- **Intervals are provisional.** The interval must exceed one incremental run (the un-stuck
  logic of decision 3). Central's first run is a full national flatten, which the scaffold
  spike times on a central stack with realistic volume. Central's database and heap
  (`BACKEND_HEAP`, 6g today) are sized from that measurement.
- **Width is provisional.** `columns=40` keeps core's default: wider flat tables risk
  MariaDB's 65,535-byte row limit. Whether a form with more than 40 columns splits cleanly is
  **unknown** until the widest config is built.

### 5. Location attribution and scope

- **Attribution.** Each event is attributed to `encounter.location_id`, falling back to
  `visit.location_id` when that is null. It is never attributed to the patient's home facility
  or to where the data was entered. Core flat tables already carry `location_id`
  (`sp_mamba_flat_encounter_table_create.sql`). Core's `mamba_dim_location` has no `uuid` or
  `parent_location`, and `mamba_dim_encounter` has no location. We add our own derived
  `mamba_dim_location_hierarchy`: each location's uuid, its facility root, district and
  county ancestors, and its tags *(amended: A3 adds four more common tables)*.
- **Detecting the role.** Use a new backend environment variable,
  **`LIBERIAEMR_INSTANCE_ROLE`**, set to `facility` or `central`. It is hard-coded in each
  compose file and cannot be overridden, the way `OMRS_CONFIG_MODULE_WEB_ADMIN` is hard-coded
  at central, and read with `System.getenv` like the module's other deployment settings. It
  **fails closed**: unset or unknown means `facility`.
- **Why the role is not inferred.** None of the existing signals is a role:
  - `LIBERIAEMR_SYNC_MONITORING_URL` is set only at central, but it is a feature toggle;
  - `FACILITY_CODE` is on the facility's `sync` service, not the backend;
  - MFL credentials may later be given to a facility (ADR 0009 decision 2);
  - central's image also carries a site package (Careysburg by default).
- **The facility's own location.** A new global property, `liberiaemr.facility.locationUuid`,
  is seeded by each site package from `${var.location.facility-root.uuid}`, the variable every
  site already declares (`content-common` `variables.properties` lines 129–132). It records the
  build's identity rather than an operator setting, so Initializer re-applying it on each
  start is intended.
- **Facility scope.** `location` defaults to the facility root and is **clamped** to it and
  its descendants. A report requested for any other location fails. So do a missing or
  unresolvable property. The same clamp keeps records pulled from other facilities out, if
  ADR 0007's query-never-replicate rule is ever relaxed and such records are persisted.
- **Central scope.** `location` accepts any MFL node, which is a County, District or Health
  Facility location. It rolls up through `parent_location` *(amended: A3, through the ETL's
  `mamba_dim_location_ancestor`)*, so a department's events count
  toward its facility, district, county and the national total. The national total is the
  empty or root selection.
- **Lag.** For a given facility and period, central lags the facility by the dbsync delay plus
  one ETL interval. The two are equal once sync has caught up and both have run. The runbook
  and the report UI say so.

### 6. `modules/liberiaemrreports`

- **What it is.** An in-tree OMOD with `require_modules` for `reporting` 2.1.0 and
  `reportingrest` 2.0.0, built in the same Dockerfile stage.
- **Registration.** Report definitions are Java `ReportManager`s, registered at startup with
  `ReportManagerUtil` under **fixed UUIDs**. They are re-saved on every start, so a change in
  SQL or the schema name takes effect on restart. Each report carries fixed-UUID CSV and Excel
  `ReportDesign`s, because reportingrest selects a rendering mode by the design's `argument`.
- **Schema resolution.** SQL reads **only the local ETL schema**. A `MambaEtlSchema`-style
  helper resolves its name from `mambaetl.analysis.db.etl_database`, requires it to match
  `[A-Za-z0-9_]+`, and substitutes it for an `${etl}` token. There are no hard-coded schema
  names, unlike `ehospitalreports`, which hard-codes `ssemr_etl.` in 5 source files against
  an `ehospital_etl` build.
- **Module dependency.** It uses **`aware_of_module`, not `require_module`, for the ETL
  module.** The reports module never loads ETL classes. It only needs the ETL module to start
  first where both are present. A missing table must make a report fail with a clear message,
  not stop the module from starting.
- **Privilege.** **`Export National Report` is enforced in the module**, inside its data set
  evaluators, in addition to reporting's own `Run Reports`. That covers every evaluating path:
  `reportRequest`, `reportDataSet` and `reportdata`. reportingrest itself checks nothing
  LiberiaEMR-specific.
  - **Open** *(closed: A8)*: `downloadReport` returns stored output without re-evaluating, so it is guarded
    only by the reporting service's own authorisation. The reports-module subtask must verify
    that guard and, if it is weaker, add advice on `ReportService.loadRenderedOutput` for our
    report UUIDs.
- **Aggregates only.** No patient-level data set ships without a further decision. Rendered
  output then holds no PHI.
- **Not copied from `ehospitalreports`:** it resets `reporting.dataEvaluationBatchSize` to −1
  on every start. We do not.

### 7. UUIDs: every literal comes from `variables.properties`

- **ETL configs.** `_etl/config/*.json` and `_etl/derived/**.sql` reference
  `${var.encountertype.*}` and `${var.concept.*}`. The `mambaetl` build filters them with the
  content layers' `variables.properties`, in layer order: common, national, mch, lab,
  pharmacy, opd-ipd. The delimiter is `${*}` only, the same filter chain as
  `content-packages/pom.xml`. **Site packages are excluded**, so ETL output cannot vary by
  site.
- **Report Java code carries no clinical UUIDs.** Coded-answer and encounter-type logic lives
  in derived SQL, which is filtered as above. Reports read named fact columns.
- **Report and design UUIDs are variables.** They are declared as `var.report.<sheet>.uuid`
  and `var.reportdesign.<sheet>-<csv|xlsx>.uuid` in
  `content-liberia-national/configuration/variables.properties`, the layer that owns
  `Export National Report`. The reports module reads them from a classpath properties file
  filtered from the same files. The UI references them as `${var.report.*}` in frontend config.
- **What the checks verify:**
  1. `validate-content.sh` "unresolved variables" scans `modules/mambaetl/**/src/main/mamba/**`
     and `modules/liberiaemrreports/**/src/main/resources/**` as well as the content packages.
     Every `${var.x}` must be declared.
  2. A new section, "hard-coded UUIDs in ETL and report sources", fails on any UUID literal
     under those paths and under `modules/liberiaemrreports/**/src/main/java/**`. It matches
     both the RFC 4122 shape and the 36-character CIEL shape (`^\d+A+$`, for example
     `5088AAAA…`). The existing frontend check matches only the dashed shape, so a CIEL UUID
     passes it today.
  3. The build fails if any `${var.` survives filtering, in either module's `target/`.
  4. The report and design UUID variables are unique. This is also the existing
     conflicting-declaration check.
  5. On a clean install, QA asserts that `_mamba_etl_error_log` is empty. A concept or
     encounter type that resolves in variables but not in the database surfaces there.

### 8. Report REST contract

reportingrest 2.0.0 serves list, run, poll and download. The verified resource names and
request shapes are in [`docs/reporting/README.md`](../reporting/README.md) §4.

#### 8a. The report UI is a new Custom Build ESM (addendum, LE-335, 27 September 2026)

**Decision: build `packages/esm-liberia-reports-app`**, not reuse or configure a community
reports app. The candidates were read from their published npm tarballs:

| Candidate | Why it does not fit |
| --- | --- |
| `@openmrs/esm-reports-app` 4.4.0 (openmrs-esm-admin-tools; **already pinned** in `distro.properties`, part of RefApp 3.7.1) | Lists **every** report definition; its only config key is `webPreviewViewReportUrl`, so it cannot be limited to the MOH reports. Its location parameter is a flat `Select` over `location?tag=Login+Location`: no county/district/facility hierarchy, no fixed facility. Its on-screen view calls `reportingrest/reportdata`, and its scheduled view `reportDefinitionsWithScheduledRequests`, both excluded by README §4.3. Admin actions are gated on `System Developer`, not `Export National Report`; its entry is a System Administration card. No ETL freshness, no disaggregation grouping, no month/quarter presets. |
| `@kenyaemr/esm-reports-app` | Calls `kenyaemr/reports` and `kenyaemr/reportRequests`; `backendDependencies` `kenyaemr ^19.0.0`. Framework 9.x. |
| `@palladium-ethiopia/esm-reports-app` | Requires the `ethiopiaemrreports` module; uses `reportdata`; framework 8.x. |
| `@nmrs-community/esm-reports-app` | A fork of the upstream app plus `nmrsreports/*` endpoints; same gaps as the upstream app. |
| `@openmrs/esm-report-builder`, `@epcare/esm-report-builder` | Report *authoring*, pre-release; not a runner. |

Wrapping the upstream app with configuration was not possible: none of the missing behaviour
is configurable, and patching it (Modify + PR) would add Liberia-specific rules (the instance
role, the MFL hierarchy, the ETL freshness endpoint) that upstream would not take. The
upstream app stays pinned for administrators; the new ESM mounts at `indicator-reports` so
the two routes do not collide.

**How the UI learns the instance role and the facility location.** Not from frontend config:
the frontend image, and the `SPA_CONFIG_URLS` baked into it, are identical at a facility and
at central (decision 0; `distribution/frontend/Dockerfile`), so config cannot differ by role.
Not from `systemsetting` either: reading a global property needs *Get Global Properties*,
which *National Reporting Officer* does not hold, and a writable role property would be a
second source of truth beside `LIBERIAEMR_INSTANCE_ROLE`. **The UI reads one small endpoint
served by `liberiaemrreports`**, proposed as `GET /ws/rest/v1/liberiaemrreports/context`
*(amended: built as proposed, plus an `etlSchema` field and a fixed status vocabulary; A7, A10)*:

```json
{
  "instanceRole": "facility",
  "facilityLocation": { "uuid": "…", "display": "Careysburg Health Center" },
  "etlLastRun": { "startedAt": "…", "completedAt": "…", "status": "…" }
}
```

- `instanceRole` is the backend's own fail-closed reading of `LIBERIAEMR_INSTANCE_ROLE`.
- `facilityLocation` is `liberiaemr.facility.locationUuid` resolved to a location, null at
  central.
- `etlLastRun` is the latest row of `_mamba_etl_schedule`, null before the first run.
- The endpoint requires `Export National Report`.

**The UI fails closed too.**

- **Role.** Anything but `central` is a facility, whose location is fixed.
- **When the UI runs nothing.** It runs and exports nothing when the endpoint does not answer,
  or when it answers without a facility UUID for a facility. It shows "Reporting context
  unavailable" instead.
- **Why it does not leave `location` out.** At central, an absent `location` means national.
  A context outage would then run a national report under a "This facility" label, and the
  backend's clamp (§5) cannot catch that.
- **Every run names its location** except national, which is sent only when the context says
  `central`.

The endpoint path and field names are isolated in `src/context/reporting-context.resource.ts`,
and settle with the reports-module subtask.

**Viewing and exporting.** "Run" submits a `reportRequest` with the CSV design and polls it.
When it completes, the on-screen table evaluates the `indicators` data set once more through
`reportDataSet`, with the same parameters. The CSV renderer writes column *labels* (the DHIS2
short names), which lose the `<CODE>_<part>` names the view groups by. "Download CSV" fetches
the completed request; "Download Excel" submits a second request with the Excel design. All
of this is §4 of the contract; nothing in §4.3 is used.

## Consequences

- **Two new in-tree OMODs ship in every image.** Neither is in `distro.properties`.
- **The Dockerfile module stage changes.** It installs `jq` and `rsync` (unpinned apt
  versions, accepted) and copies `variables.properties`.
- **`modules.yml` must build and test all three modules.** *(Amended: A6; `mambaetl` is built
  and tested in `ci.yml` instead.)*
- **Database server flags change** *(amended: A1 adds a fifth flag and measures the cost)*.
  - Facility `db.command` gains `--binlog-ignore-db=liberiaemr_etl`,
    `--log-bin-trust-function-creators=1`, `--event-scheduler=ON` and `--performance-schema=ON`.
  - Central's gains the last two.
  - All four need a `db` restart.
  - `performance_schema` costs memory at small facilities, which the scaffold spike measures.
    If the cost is too high, the fallback is an override of `sp_mamba_etl_un_stuck_scheduler`
    in our `_etl`, which is a fork of core behaviour to avoid.
- **The ETL schema is a new full copy of clinical data at rest** at every facility and at
  central. Core dimensions include person names, addresses and identifiers. It must join
  the canonical list in [sync architecture](../architecture/sync-eip.md) §7.4 and the scope of
  control D3.
  - It is excluded from binlog volume, and so from the binlog copy.
  - It is rebuildable, so a restore may skip it and re-flatten instead.
- **The ETL's own connection pool** adds up to 20 connections per instance. The MariaDB
  default `max_connections` is 151.
- **Central's numbers depend on central holding every live facility's locations.** That is the
  unresolved consequence recorded in ADR 0009, which this ADR inherits. Records at an unknown
  location cannot arrive, because the receiver rejects them. A root created twice would split a
  facility's totals.
- **QA gate** (definition of done). A clean facility stack and a clean central stack each
  build flat tables, incrementally as well, with an empty `_mamba_etl_error_log`, and:
  - `SHOW BINLOG EVENTS` at the facility contains no `liberiaemr_etl` event after an ETL run;
  - Debezium's offset advances with no ETL table in its history;
  - after sync catches up, a facility's report equals central's report for that facility and
    period.

### Changes against the tickets

- **The matrix is no longer one shared file.** The tickets name
  `docs/reporting/indicator-feasibility.csv`. The coordinator split it into one file per sheet
  group under `docs/reporting/feasibility/`, so that the three parallel branches cannot
  conflict. The matrix is their union; the schema is unchanged.
- **The tickets underspecify what the database needs.** They name `log_bin_trust_function_creators`
  or SUPER for routine creation. Core also needs `event_scheduler` turned on without its
  in-script `SET GLOBAL`, and `performance_schema` access. Without them `setupEtl()` fails on
  both stacks, with any non-SUPER user.
- **There are two released core versions, not one.** The tickets name only 3.0.0; 2.0.0 is
  also released. 3.0.0 is chosen here, but it is new: published 17 September 2026, with no
  field record.
- **`concepts_locale` in a config JSON is ignored by 3.0.0.** Core reads the locale only from
  `mambaetl.analysis.locale`. The key is kept for readability.

## Amendment (2026-09): what building and verifying found

**29 September 2026 · LE-362.** The decisions above were written before the modules existed.
The wave-2 and wave-3 builds were then run on real facility and central stacks: the ETL module
(LE-331, PR #168), the reports module (LE-337, PR #169), the report UI (LE-335, PR #170), the
fixtures (LE-336, PR #171) and the late-synced-rows fix (LE-363, PR #174). This section records
what they found and what changed. Each point cites the code on `main` that now holds it.
Nothing below reverses decision 0.

### A1. MariaDB needs a fifth flag, and `performance_schema` costs about 95 MiB

`--performance-schema=ON` alone is **not enough**. MariaDB ships the `events_statements_current`
consumer switched off, so with only that flag core's stuck-run check still reads 0 rows, and
ETL runs can overlap (the failure decision 3 describes). Both stacks therefore also set
`--performance-schema-consumer-events-statements-current=ON`:

- facility: `distribution/compose/facility/docker-compose.yml`, the five ETL flags on lines
  42–46, explained on lines 22–31;
- central: `distribution/compose/central/docker-compose.yml`, lines 23–25, explained on lines
  13–18.

**Measured cost:** about 95 MiB of resident memory per MariaDB at `max_connections=151`: 175.8 MiB
against 80.75 MiB idle. The Consequences named an override of `sp_mamba_etl_un_stuck_scheduler` as
the fallback if the cost were too high. It is **not** taken: the flag ships on both stacks,
95 MiB is accepted, and core's stuck-run logic stays unforked.

### A2. The ETL user's initdb keeps secrets out of the binlog, and central may read the CPI

- **No password in the binlog.** Both initdb scripts run their statements with
  `SET SESSION sql_log_bin = 0` (`distribution/compose/facility/initdb/20-etl-db-user.sh` lines
  42 and 54; `distribution/compose/central/initdb/30-etl-db-user.sh` lines 42 and 58).
  Otherwise `CREATE USER … IDENTIFIED BY` would write the ETL password to the facility binlog in
  clear text, for the whole retention period. Nothing downstream replays account statements.
  The by-hand runbook for an existing database must do the same.
- **Central only: `GRANT SELECT ON openmrs_identity.*`** to the ETL user (`30-etl-db-user.sh`
  line 52). That schema holds the CPI (ADR 0005). `mamba_dim_person_cpi` (A3) reads it, and
  that gives central a key that counts each person once. A facility has no such schema and no
  such grant, and the same SQL runs unchanged there.
- Both scripts are skipped when `ETL_DB_PASSWORD` is unset, and there is still no fallback to
  the OpenMRS user.

### A3. Four common tables beyond the ADR; roll-up goes through a closure table

Decision 5 named one derived common table, `mamba_dim_location_hierarchy`. The `common`
section of `modules/mambaetl/api/src/main/mamba/_etl/sp_makefile` builds five:

| Table | Built by | Why |
| --- | --- | --- |
| `mamba_dim_location_ancestor` | `derived/common/sp_mamba_dim_location_hierarchy.sql` | One row per location and each of its ancestors, itself included, with the depth. **Roll-up reads this, not `parent_location`.** The hierarchy's three tagged levels (facility, district, county) would miss the descendants of an untagged node, such as a ward. The walk is capped at depth 32 and absorbs a cycle. |
| `mamba_dim_location_hierarchy` | the same file | Each location's uuid and parent, and its **nearest** ancestor-or-self tagged Health Facility, District and County. Tags are compared by uuid. |
| `mamba_dim_encounter_location` | `derived/common/sp_mamba_dim_encounter_location.sql` | The attribution location, `encounter.location_id` falling back to `visit.location_id`, held in one place. Every fact takes its `location_id` from here. |
| `mamba_dim_person_cpi` | `derived/common/sp_mamba_dim_person_cpi.sql` | `person_key`, which is the primary CPI at central (following alias chains the way `IdentityService.primary()` does) or `patient:<uuid>` at a facility. People are counted with `COUNT(DISTINCT person_key)`. |
| `mamba_dim_encounter_form` | `derived/common/sp_mamba_dim_encounter_form.sql` | The form of each encounter. Core flattens per encounter type, and several forms share one. |

**How the reports use the ancestor table.** `LocationScope` (`modules/liberiaemrreports/api/…/scope/LocationScope.java`)
expands the `${scopeLocations}` token in report SQL to a subquery over
`mamba_dim_location_ancestor`:
`ancestor_location_id = :scopeLocationId`, or every location for a national run. It uses the
same expansion at a facility and at central, so a facility's report equals central's report
filtered to it. The facility clamp is checked before any SQL runs:
`LocationScopeResolver.isSameOrDescendant` walks the OpenMRS `parent_location` chain in Java.

### A4. Incremental runs find new rows by key and modified rows by value

**The problem.** Core 3.0.0 finds new and changed rows by timestamp. dbsync keeps each facility's
original timestamps, so at central a row that syncs after a run has started is never
flattened. Back-dated data behaves the same way at a facility. **The fix is a deliberate fork
of four core procedures.** `modules/mambaetl/api/src/main/mamba/_etl/core_overrides/` holds them.
Each has the same name as core's procedure and is compiled after it, so ours is the definition
deployed. `DeployScriptTest` fails the build if that stops being true.

1. **New rows** (`sp_mamba_etl_incremental_columns_index_new_insert`). A key is new if the
   table does not hold it and it is above the table's previous maximum, less a margin of
   10,000. Once a day per table a **sweep** drops that bound, and so does the first incremental
   run after a full one. State is kept in `mamba_etl_liberia_incremental_state`.
2. **Modified rows** (`sp_mamba_etl_incremental_columns_index_modified_insert`). Core's timestamp
   test is kept. A row also counts as modified when any stored change column differs from the
   source: `date_changed`, `voided`, `date_voided`, `retired` or `date_retired`.
3. **Identifier updates** (`sp_mamba_dim_patient_identifier_incremental_update`). Core joined the
   modified `patient_identifier_id` keys to `patient_id`, so it rewrote the wrong patient's
   identifiers. The join now uses `patient_identifier_id`.
4. **Full runs** (`sp_mamba_dim_encounter_insert`). `mamba_dim_encounter` is now built the same
   way as on incremental runs: every encounter of a known type, not only the types that have a
   flat table.

- **No scheduled full rebuild.** A full run drops every `mamba_*` table first, so reports would
  read empty tables until it finished. **A manual full run is the recovery path**, after a
  restore or a bulk correction. The steps are in `modules/mambaetl/README.md`, "Incremental runs
  and late-arriving rows".
- **Upgrade rule, added to decision 1.** **Every core upgrade must compare each override with the
  new core's version of the same procedure** before the QA gate. A changed upstream procedure is
  silently replaced by ours.

### A5. Reading an ETL run's status

Core's `sp_mamba_etl_un_stuck_scheduler` rewrites the previous `_mamba_etl_schedule` row on each
tick if that row ended in `ERROR` or was left `RUNNING`. It **relabels** such a row as
`completion_status = SUCCESS`, with the message `Error schedule updated` or `Stuck schedule
updated`, and resets its times. **A genuine success is therefore `transaction_status = COMPLETED`,
`completion_status = SUCCESS` and a null message.** `ReportingContextService.status`
(`modules/liberiaemrreports/api/…/context/ReportingContextService.java`, line 127) maps rows to
`SUCCESS`, `RUNNING`, `INTERRUPTED` (a stuck run core closed) or `ERROR`. A `SUCCESS` row with
any other message maps to `ERROR`. The times on a non-`SUCCESS` row are not that run's own.
`_mamba_etl_error_log` is the lasting record of failures.

### A6. Build and CI, as built

- **The api-module phases** (`modules/mambaetl/api/pom.xml`) differ from decision 2's table.
  They are:

  | Phase | Step |
  | --- | --- |
  | `validate` | clean `target/mamba-etl` |
  | `initialize` | unpack core's `_core/**` |
  | `generate-resources` | filtered copy of `_etl` |
  | `process-resources` | core's `compile.sh` |
  | `process-classes` | `src/main/sh/finalize-jdbc-sql.sh` |

  The finalize script strips `SET GLOBAL` and fails the build on a leftover `${var.`,
  `SET GLOBAL` or `DELIMITER`, or on a procedure missing from `sp_makefile`.
- **The `openmrs-web` exclusion is load-bearing** (`modules/mambaetl/pom.xml`, on the
  `mamba-core-api` dependency). Core's pom declares `openmrs-web:tests` with no scope. Without
  the exclusion, that jar and about 50 webapp libraries (Spring, Liquibase, Struts,
  servlet-api) land in the OMOD's `lib/` and shadow the platform's copies. With it, `lib/`
  holds four jars: the module's api jar, `mamba-core-api`, `commons-dbcp2` and `commons-pool2`.
- **`liberiaemrreports` uses `maven-parent-openmrs-module` 2.2.0**, not the 1.1.1 that
  `liberiaemr` and `mambaetl` use (`modules/liberiaemrreports/pom.xml`). 1.1.1 adds powermock 1.5
  and mockito 1.9.5, and powermock 1.5 cannot load beside the mockito 3 that `openmrs-test`
  brings. With 1.1.1, no context-sensitive test could start.
- **Where CI builds the modules.** The Consequences said `modules.yml` would build all three.
  As built:
  - `mambaetl` is built and tested by `ci.yml`'s `backend-module` job ("Build and test the
    reporting ETL module");
  - `liberiaemrreports` is in the root reactor (`pom.xml`), so `ci.yml`'s `mvn verify`, the
    dependency scan and the SBOM all see it. `modules.yml` also builds it
    (`build-and-test-reports`). Neither module is published to Repsy.
- **The OWASP step runs `package` before `check`** (`ci.yml`, "Run OWASP Dependency Check"). The
  reports omod depends on its sibling api jar, and unpacks it (MDEP-98), so that jar must be
  packaged before the reactor can resolve it.
- **Coverage reaches SonarQube.** JaCoCo 0.8.12 runs in `liberiaemrreports` only:
  `prepare-agent`, then `report` at `test`, writing `target/site/jacoco/jacoco.xml`, which
  `sonar.coverage.jacoco.xmlReportPaths` points at. Without it, every line the module adds counts
  as uncovered new code. On a failed quality gate, `ci.yml`'s "Explain a failed SonarQube quality
  gate" step prints the failing conditions, the new issues and the unreviewed hotspots from the
  Sonar API. The Sonar server is not visible to most contributors.

### A7. The UI reads one endpoint outside reportingrest

Decision 8 and §8a said the UI uses reportingrest only, plus a *proposed* context endpoint. The
endpoint is now built: `GET /ws/rest/v1/liberiaemrreports/context`
(`modules/liberiaemrreports/omod/…/web/controller/ReportingContextController.java`, served by
`ReportingContextService`). **The contract is therefore "reportingrest, plus this one read-only
endpoint".** The UI needs it for the instance role and ETL freshness, which reportingrest cannot
supply.

- **Guard.** It returns 401 when unauthenticated and 403 without `Export National Report`.
- **Fields.** It returns `instanceRole`, `facilityLocation`, `etlSchema` (not in §8a) and
  `etlLastRun`, with the status vocabulary of A5.
- **Privileges.** The global property and the location are read under proxy privileges, because
  *National Reporting Officer* holds neither Get Global Properties nor necessarily Get Locations.

The contract is `docs/reporting/README.md` §4.4.

### A8. reporting has no authorisation, so the module adds its own

**reporting 2.1.0's `ReportService` carries no `@Authorized` on any method.** Before this
module, any logged-in user holding a request UUID could download a stored national report.
`liberiaemrreports` closes that in two places.

- **Evaluation** (`security/NationalReportPrivilege.check`, called first by
  `EtlSqlDataSetEvaluator`). The current user must hold `Export National Report`. A queued
  `reportRequest` is evaluated later on reporting's daemon thread, where every privilege check
  passes. So when the evaluation belongs to a request, **the user who requested it** must hold
  the privilege. A daemon evaluation that belongs to no request is refused.
- **Stored output** (`security/StoredReportAccessAdvice`, registered as `<advice>` on
  `ReportService` in `omod/src/main/resources/config.xml`). It requires the privilege on
  `loadRenderedOutput`, `loadReportData` and `loadReport` for requests of this module's reports.
  This closes decision 6's open question. A request counts as ours, and **fails closed**, in these
  cases:
  - its report UUID is one of the sheets;
  - its definition runs any `EtlSqlDataSetDefinition` under another UUID;
  - its definition reference is missing;
  - the definition can no longer be found;
  - the lookup throws.

  Daemon-thread calls are passed through: the requester was already checked at evaluation.

### A9. Only registered ETL SQL is evaluated

`EtlSqlDataSetEvaluator` runs a data set only if its name **and** exact SQL match one that a
registered `LiberiaReportManager` builds (`reporting/RegisteredEtlDataSets.require`). The
expected set is rebuilt from code on every call, not read from the database. As a result:

- an ad-hoc definition POSTed to reportingrest's `reportdata` is refused before any SQL runs;
- so is a stored definition altered by someone with reporting's *Manage Report Definitions*.

The name-based aggregate check comes after this one. It catches a mistake in our own SQL, not a
hostile alias. `RegisteredDataSetOnlyTest` covers both refusals.

**Outside this module:** reporting's own `SqlDataSetDefinition` remains reachable through
`reportdata`, limited only by reporting's own privileges. That is reporting's surface, not ours,
and it is recorded here so that nobody reads A9 as closing it.

### A10. Contract points from the UI

- **Not-captured notes live in `ReportDefinition.description`**
  (`LiberiaReportManager.getDescription`). The description is a one-line summary, then one line
  per note from `getNotes()`. The UI shows it with the report.
- **DHIS2 UIDs have no route to the UI yet.** reportingrest's data-set column metadata carries no
  `description`, so the plan in `docs/reporting/README.md` §3.3 (the DHIS2 UID in the column
  description) cannot reach the browser through reportingrest. A later DHIS2 push reads the
  columns on the server, where the plan still holds.
- **The view and the file are evaluated separately.** The on-screen table evaluates the
  `indicators` data set through `reportDataSet`, apart from the rendered CSV, because the CSV
  writes column labels and loses the `<CODE>_<part>` names the view groups by. So one run
  evaluates twice. If the ETL runs in between, the two can differ.
- **The UI fails closed without context** (`packages/esm-liberia-reports-app/src/context/reporting-context.resource.ts`,
  `toReportingContext` and `isLocationKnown`). This is §8a as built. The UI runs and exports
  nothing when the endpoint does not answer, or when a facility has no facility UUID. Anything
  but `central` is a facility.

### A11. Threat-model decisions accepted in review

- **The facility clamp rests on a global property.** `liberiaemr.facility.locationUuid` can be
  changed by anyone who can edit global properties. **Accepted:** that is an administrator
  privilege. Initializer re-applies the site package's value on every start
  (`content-site-*/configuration/backend_configuration/globalproperties/gp-facility-*.xml`), so
  an edit lasts only until the next restart.
- **Report definitions edited after a run.** Stored-output protection (A8) inspects the
  definition as it is *now*. A copy saved under another UUID and later edited so that it no longer
  runs our ETL data sets would let its older stored output out without the privilege. That edit
  needs *Manage Report Definitions*, an administrator privilege. **Accepted as an admin-only
  risk.** If MOH security asks, the next step is **provenance**: record, at run time, that a
  request ran our data sets, and guard on that record rather than on the current definition.
  The five sheet report UUIDs themselves are always guarded, and they are re-saved from code on
  every start.

## Decision record

Every row is built and merged. "Proposed" is the ADR's status, not a build state: acceptance
is its owner's call. The Amended column points to the amendment.

| # | Decision | Status | Amended |
| --- | --- | --- | --- |
| 0 | Per-instance ETL and reports; ETL never synced; attribution by encounter/visit location | Decided 27 Sep 2026 (recorded) | |
| 1 | `modules/mambaetl` (`mamba-etl-liberiaemr`), `mamba-core-api` 3.0.0 bundled, not in `distro.properties` | Proposed | A4 (core overrides; compare each on every core upgrade), A6 |
| 2 | Compile in the api module before `package`; strip `SET GLOBAL`; nothing generated committed | Proposed | A6 (phases as built; CI placement) |
| 3 | `log_bin_trust_function_creators=1` (facility), `event_scheduler=ON`, `performance_schema=ON` **with its `events_statements_current` consumer**, `binlog-ignore-db` (facility), dedicated ETL user | Proposed | A1, A2 |
| 4 | `OMRS_EXTRA_MAMBAETL_*` per stack; intervals and width provisional | Proposed | |
| 5 | Encounter→visit location; `LIBERIAEMR_INSTANCE_ROLE`, failing closed; site-seeded facility location GP; roll-up through `mamba_dim_location_ancestor` | Proposed | A3, A11 |
| 6 | `liberiaemrreports`: fixed UUIDs, runtime schema, `aware_of` ETL, privilege in evaluators (checked against the requester of a queued run), guard on stored output, registered SQL only | Proposed | A8, A9, A11 |
| 7 | UUIDs via filtered `variables.properties`; checks extended to modules and CIEL-shape UUIDs | Proposed | |
| 8 | reportingrest 2.0.0 contract in `docs/reporting/README.md`, plus the `liberiaemrreports/context` endpoint | Proposed | A7, A10 |
| 8a | New `esm-liberia-reports-app`; role, facility and ETL freshness from a `liberiaemrreports` context endpoint; UI fails closed to facility | Proposed (LE-335) | A7, A10 |
