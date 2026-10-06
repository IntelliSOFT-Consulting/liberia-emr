# Indicator reporting: contracts

These are the contracts that the indicator-report workstreams build against: the feasibility
matrix, the ETL configuration, the report definitions and the REST calls the UI makes. The
design and its reasons are in
[ADR 0010](../adr/0010-indicator-reporting-mamba-etl.md). If this page and the ADR disagree, the
ADR wins until this page is corrected.

| Wave | Workstreams | Reads | Writes |
| --- | --- | --- | --- |
| 1 | feasibility review (RPT 1–3) | the workbook, content packages | `feasibility/*.csv`, `feasibility/*-gaps.md` (§1) |
| 1 | ADR and contracts (RPT 4, coordinator) | everything | ADR 0010, this page |
| 2 | ETL scaffold (RPT 5), ETL configs and derived SQL (RPT 6, RPT 7), reports scaffold (RPT 11) | §1, §2 | `modules/mambaetl/**`, `modules/liberiaemrreports/**` scaffold |
| 3 | report definitions (RPT 8), report UI (RPT 9) | §2, §3, §4 | report `ReportManager`s, the UI |
| QA | fixtures and expected counts (RPT 10) | §1 | `qa/**` |

The coordinator reviews every hand-off and resolves overlaps. For example, ANC data used by
both RMNCAH and Malaria indicators gets **one** flat table, not two.

---

## 1. Feasibility matrix

The matrix is the **union of `docs/reporting/feasibility/*.csv`**. There is one file per sheet
group, so the parallel branches never edit the same file:

| File | Sheets | Codes |
| --- | --- | --- |
| `feasibility/rmncah-nutrition.csv` | RMNCAH, Nutrition | `RMNCAH-009`…`030`, `NUT-001`…`023` |
| `feasibility/malaria-ncd.csv` | Malaria, NCD | `MAL-001`…`019`, `NCD-001`…`019` |
| `feasibility/emr-ops.csv` | EMR-Ops | `EMR-OPS-001`…`017` |

Each file has a `<name>-gaps.md` beside it. It explains every row that is not *Feasible now*:
what is missing, and which content change or new capture would close it.

**Open MOH decisions.** [`moh-decisions-le-356.md`](moh-decisions-le-356.md) (LE-356) asks the
MOH to rule on the rows whose workbook definitions contradict their names (NUT-005, NUT-007,
NUT-009, MAL-003), on facility-attendee proxies for two survey indicators (NCD-008, NCD-010),
and on the proposed `emr_priority` of every row. Until the MOH answers, the matrix and the
reports keep the readings that the brief describes as implemented today.

**The schema is fixed.** Every file has exactly this header, in this order:

```
code,sheet,name,classification,numerator_source,denominator_source,forms,encounter_types,concepts,disaggregations_supported,disaggregations_missing,flat_table,report_uuid,emr_priority,notes,owner
```

**Format rules:**

- RFC 4180 CSV, UTF-8, comma-separated. A field that contains a comma, a quote or a newline
  is double-quoted, and an embedded quote is doubled.
- One row per workbook indicator, and no blank lines.
- Within a field, list items are separated by **`; `**.
- No raw UUIDs. Use a variable key or a name (see the columns below).

| Column | Meaning | Values |
| --- | --- | --- |
| `code` | The workbook code, verbatim. It is unique across the union and is the join key for every later stage | e.g. `MAL-004` |
| `sheet` | The workbook sheet the row comes from | `RMNCAH`, `Nutrition`, `Malaria`, `NCD`, `EMR-Ops` |
| `name` | The indicator name, verbatim from the workbook | text |
| `classification` | Whether the EMR can produce the indicator today (definitions below) | exactly one of the four values |
| `numerator_source` | How the numerator is counted: the form, encounter type and concept logic, in words. For a *Not EMR-sourced* row, the external source the workbook names (DHS, MIS, CRVS, iHRIS…) | text |
| `denominator_source` | The same for the denominator. A population or catchment denominator is written as such, because the EMR does not hold one | text |
| `forms` | AMPATH form `name`s as they appear in the form JSON, not versions or UUIDs | `;`-list |
| `encounter_types` | Encounter type names as declared in content. A qualifier in parentheses is allowed, e.g. `Consultation (shared; key on form)` | `;`-list |
| `concepts` | Concept variable keys without the `var.` prefix (`concept.ciel.muac.uuid`), or `CIEL:<id>`. A pointer into the gaps file is allowed where the list is long | `;`-list |
| `disaggregations_supported` | The disaggregations the EMR can supply for this row. Start each item with one of `age`, `sex`, `facility`, `district`, `county`, `period` where one applies, then qualify it freely | `;`-list |
| `disaggregations_missing` | The disaggregations the workbook asks for that the EMR cannot supply, e.g. `residence`, `socio-economic status` | `;`-list |
| `flat_table` | The ETL table the report reads: `mamba_flat_encounter_<form>` or `mamba_fact_<area>_<name>` (§2). Empty in wave 1 unless it is obvious; wave 2 fills it | table name |
| `report_uuid` | The **variable key** of the report that carries the row, `report.<sheet-slug>.uuid` (§3). Never the UUID itself. Empty until wave 3 | variable key |
| `emr_priority` | Build priority, set by the coordinator when the files are consolidated. It may be empty in wave 1 | `High`, `Medium`, `Low`, empty |
| `notes` | Anything a later stage needs: an assumption, a data-quality risk or a gap reference | text |
| `owner` | The Jira key of the subtask that owns the row. A row changes owner only through the coordinator | e.g. the key on the owning branch |

**Classifications:**

| Value | Meaning | Built? |
| --- | --- | --- |
| `Feasible now` | Current forms, concepts, encounter types and configuration produce it with no content change. Before an MCH row can be marked *Feasible now*, its coded answers must resolve against the `LIB/mch` OCL collection | yes, in wave 2–3 |
| `Feasible with content change` | Only configuration or content is missing: a concept mapping, a form field, an answer set or a program state | after a content ticket |
| `Needs new data capture` | The EMR does not collect the data, so a new form, workflow or attribute is needed | after a design decision |
| `Not EMR-sourced` | The workbook's own source is outside the EMR (a survey, CRVS, iHRIS, a facility assessment or a register), or the denominator is a population the EMR does not hold | no; classified only |

Checking a file locally: `python3 -c "import csv,sys;[print(len(r)) for r in csv.reader(open(sys.argv[1]))]" <file> | sort -u`
must print exactly `16`.

---

## 2. ETL configuration (`modules/mambaetl`)

### 2.1 Layout

```
modules/mambaetl/api/src/main/mamba/_etl/
├── config/<form>.json                 one flat table per encounter type
├── core_overrides/sp_*.sql            same-named replacements for four core procedures
├── derived/<area>/sp_mamba_fact_<area>_<name>.sql
├── sp_makefile                        lists every derived SP, in per-owner sections
└── sp_mamba_data_processing_etl.sql   calls the derived SPs in dependency order
```

`<area>` is one of `rmncah`, `nutrition`, `malaria`, `ncd`, `emr_ops` or `common`. Shared
dimensions such as location hierarchy, age bands and encounter form go under `common`.

**The build.** It filters these files with the content `variables.properties`, then compiles
them with core 3.0.0's `compile.sh`, and ships `mamba/jdbc_create_stored_procedures.sql` in the
api jar (ADR 0010 decision 2). Nothing generated is committed.

**Core overrides.** `core_overrides/` replaces four core 3.0.0 procedures, so that incremental
runs find late-synced rows: new rows by key, modified rows by value (ADR 0010 amendment A4;
`modules/mambaetl/README.md`). These files belong to the coordinator. On every core upgrade,
compare each one with the new core's version of the same procedure.

### 2.2 `config/<form>.json`

```json
{
  "report_name": "ANC Initial Visit",
  "flat_table_name": "mamba_flat_encounter_anc_initial",
  "encounter_type_uuid": "${var.encountertype.anc-initial.uuid}",
  "concepts_locale": "en",
  "table_columns": {
    "gestational_age_weeks": "${var.concept.national.gestational-age-weeks.uuid}",
    "muac_cm": "${var.concept.ciel.muac.uuid}"
  }
}
```

- **One file per encounter type.** `<form>` is the file name and the table suffix, in
  `snake_case`.
- **`flat_table_name`** is exactly `mamba_flat_encounter_<form>`. It is unique, at most 64
  characters (the MariaDB identifier limit), and never renamed once reports read it.
- **`encounter_type_uuid` and every value in `table_columns` is a `${var.*}` token**, never a
  literal. The build resolves them from the same filter chain as `content-packages/pom.xml`:
  common, national, mch, lab, pharmacy, opd-ipd. **Site packages are not in the chain.** A
  token that no layer declares fails `validate-content.sh`.
  - Use the variable the content already declares. There are two existing namespaces,
    `var.encountertype.*` and `var.encountertypes.*`; use whichever declares the one you need,
    and do not add aliases.
  - A concept with no variable gets one in the layer that owns it, in the same PR, following
    `CONTRIBUTING.md`.
- **`table_columns` keys** become column names. They are `snake_case`, at most 64
  characters, and unique within the file. Use the DHIS2 data-element short name where one
  exists (§3.3).
- **Keep a file to 40 columns or fewer.** `mambaetl.analysis.columns=40`, and a wider table
  is partitioned by core. Whether that works on MariaDB is still unverified.
- **`concepts_locale`** is kept for readability. Core 3.0.0 ignores it and reads the locale
  from `mambaetl.analysis.locale`.
- **No `reports.json`.** Core's own report API is unused; reports go through `reportingrest`.

**A form's `version` is part of its identity** (AMPATH form UUIDs are derived from name and
version). The ETL keys on the **encounter type**, so a new form version needs no ETL change as
long as its encounter type and concepts stay the same.

### 2.3 Location on every flat and fact table

- **Flat tables.** Core flat tables already carry `encounter_id`, `visit_id`, `client_id`,
  `encounter_datetime` and `location_id`, which is `encounter.location_id`.
- **Fact tables.** Every `mamba_fact_*` table carries:
  - `encounter_id`, or the fact's own grain key;
  - `client_id`;
  - `encounter_datetime`, or the fact's own event date;
  - **`location_id`**: the attribution location, which is `encounter.location_id`, or
    `visit.location_id` when that is null;
  - **`facility_location_id`**, taken from `mamba_dim_location_hierarchy`.
- **The `common` area** provides:
  - `mamba_dim_location_hierarchy`: `location_id`, `uuid`, `name`, `parent_location_id`,
    `facility_location_id`, `district_location_id`, `county_location_id`, `tags`, `tag_uuids`
    and `retired`. The three level columns hold the **nearest** ancestor-or-self with the Health
    Facility, District or County tag, and tags are compared by uuid. It is built from
    `openmrs.location` and its tag map, because core's `mamba_dim_location` has neither uuid
    nor parent. Use it for `facility_location_id` and for display, **not for roll-up**: a
    descendant of an untagged node, such as a ward, would be missed;
  - `mamba_dim_encounter_form`: `encounter_id` and `form_uuid`. It is needed wherever several
    forms share an encounter type (for example *Consultation*). Filter on the form's
    `${var.form.*}` tokens, **every version of the form included**. It also has `form_id`, and
    it keeps retired form versions;
  - `mamba_dim_location_ancestor`: one row per `location_id` and each of its ancestors,
    itself included (`ancestor_location_id`, `depth`). It is built in the same procedure as the
    hierarchy (`sp_mamba_dim_location_hierarchy.sql`). **All roll-up goes through it.** To report
    on any MFL node, join on `ancestor_location_id` = that node. Report SQL does not write that
    join itself; it writes `${scopeLocations}` (§3.2);
  - `mamba_dim_encounter_location`: `encounter_id`, `visit_id` and **`location_id`, the
    attribution location** as defined above. Every fact takes its `location_id` from here;
  - `mamba_dim_person_cpi`: `person_id` and **`person_key`**. Count people with
    `COUNT(DISTINCT person_key)`. At central the key is the primary CPI from
    `openmrs_identity`, so a person with records at two facilities counts once. At a facility
    it is the patient itself.
- **Attribution rule.** Never attribute by patient address, patient identifier prefix or
  creator.

### 2.4 Derived tables and `sp_makefile`

- **Naming.** A derived table is `mamba_fact_<area>_<name>`, built by
  `derived/<area>/sp_mamba_fact_<area>_<name>.sql`. The procedure has the same name. Build it
  idempotently: create if absent, then insert or update from the flat tables.
- **Literals.** Coded answers, program states and encounter types are compared by UUID, never
  by name, and each UUID is a `${var.*}` token.
- **Context.** The SQL runs in the ETL schema's context. Source tables are qualified as
  `mamba_source_db.<table>` (core replaces the placeholder at runtime). **Never issue ETL DDL
  from an `openmrs`-context session**, which would reach the facility binlog (ADR 0010
  decision 3).
- **The makefile.** `sp_makefile` has one section per owner, in the order shown below. A
  workstream edits only its own section; `common` belongs to the coordinator.

  ```
  # ---- common (coordinator) ----
  derived/common/sp_mamba_dim_location_hierarchy.sql
  derived/common/sp_mamba_dim_encounter_form.sql
  derived/common/sp_mamba_dim_encounter_location.sql
  derived/common/sp_mamba_dim_person_cpi.sql
  # ---- rmncah (RPT 6) ----
  # ---- nutrition (RPT 6) ----
  # ---- malaria (RPT 7) ----
  # ---- ncd (RPT 7) ----
  # ---- emr_ops (RPT 7) ----
  ```

- **The caller.** `sp_mamba_data_processing_etl.sql` calls the SPs in the same order. Where
  two indicators need the same encounter data, the second workstream reuses the first one's
  flat table.

---

## 3. Report conventions (`modules/liberiaemrreports`)

### 3.1 One report per sheet

| Sheet | Report name | Report UUID variable | Design UUID variables |
| --- | --- | --- | --- |
| RMNCAH | `MOH RMNCAH Indicators` | `var.report.rmncah.uuid` | `var.reportdesign.rmncah-csv.uuid`, `var.reportdesign.rmncah-xlsx.uuid` |
| Nutrition | `MOH Nutrition Indicators` | `var.report.nutrition.uuid` | `var.reportdesign.nutrition-csv.uuid`, `…-xlsx.uuid` |
| Malaria | `MOH Malaria Indicators` | `var.report.malaria.uuid` | `var.reportdesign.malaria-csv.uuid`, `…-xlsx.uuid` |
| NCD | `MOH NCD Indicators` | `var.report.ncd.uuid` | `var.reportdesign.ncd-csv.uuid`, `…-xlsx.uuid` |
| EMR-Ops | `MOH EMR Operational Indicators` | `var.report.emr-ops.uuid` | `var.reportdesign.emr-ops-csv.uuid`, `…-xlsx.uuid` |

- **Where the UUIDs are declared.** The reports scaffold subtask declares all 15 UUIDs once, in
  `content-packages/content-liberia-national/configuration/variables.properties`. That is the
  layer that owns `Export National Report`. Once released, they are **never changed**.
- **How Java reads them.** Report code reads them from a classpath properties file that the
  module build filters from the same `variables.properties` files. There are no UUID literals
  in Java.
- **How the UI reads them.** Through `${var.report.*}` in frontend config.
- **Registration.** Each report is a `ReportManager`, registered at startup under its fixed
  UUID and re-saved on every start. The CSV and Excel designs also have fixed UUIDs, because
  reportingrest picks the rendering mode by the design's UUID (§4.2).
- **Aggregates only.** No patient-level data set without a further decision.

### 3.2 Parameters

Every report takes the same three parameters, with these exact names:

| Name | Type | Facility instance | Central instance |
| --- | --- | --- | --- |
| `startDate` | `java.util.Date`, required | inclusive, 00:00 | same |
| `endDate` | `java.util.Date`, required | inclusive, to 23:59:59 | same |
| `location` | `org.openmrs.Location`, optional | defaults to the facility (`liberiaemr.facility.locationUuid`) and is **clamped** to it and its descendants; any other value fails the run | any County, District or Health Facility location. Events roll up through `mamba_dim_location_ancestor`, so the node counts itself and every location below it at any depth; empty means national |

- **How the role is known.** From `LIBERIAEMR_INSTANCE_ROLE` (`facility` or `central`). It
  fails closed to `facility`.
- **Date comparison.** The period is compared against the fact's event date, which by default
  is `encounter_datetime`, never `date_created`.
- **Location in SQL.** Report SQL filters on the attribution location with
  `<fact>.location_id IN ${scopeLocations}` and never builds its own location filter.
  `LocationScope` expands the token to a subquery over `${etl}.mamba_dim_location_ancestor`,
  bound to the resolved node or to every location for a national run. The expansion is the same
  at a facility and at central, so a facility's report equals central's report for it. The
  facility clamp is checked in Java before any SQL runs (`LocationScopeResolver`).

### 3.3 Columns

- **Naming.** Data set columns are named `<CODE>_<part>`, with the workbook code upper-cased
  and `-` replaced by `_`, e.g. `MAL_004_NUM`, `MAL_004_DEN`, `MAL_004_PCT`.
- **Disaggregations** are suffixes: `_F`/`_M`; age bands such as `_LT1`, `_1_4`, `_5_14`,
  `_15_49`, `_50PLUS`, as the workbook defines them; and `_BY_FACILITY` data sets at central.
- **DHIS2 alignment.** Where an indicator maps to a DHIS2 data element, the column **label**
  is that element's short name. Its `description` holds the DHIS2 UID once the MOH mapping
  exists; those mappings are still blocked in `central.env.example`. A later DHIS2 push then
  consumes the columns unchanged on the server.
  - **The UI cannot see the UID.** reportingrest's data-set column metadata has no
    `description`, so no DHIS2 UID reaches the browser through §4 (ADR 0010 amendment A10).
- **Notes.** What a report does not capture (a missing disaggregation, a numerator-only
  indicator) is written one line per note into `ReportDefinition.description`, after a one-line
  summary (`LiberiaReportManager.getNotes`). The UI shows it with the report.
- **Grouping.** One data set per sheet, keyed `indicators`. A row-per-facility breakdown is a
  second data set, `by_facility`, at central only.

### 3.4 Privilege

- **Who may run a report.** Running, evaluating or exporting any of these reports requires
  **`Export National Report`**, as well as reporting's own `Run Reports`/`View Reports`.
  *National Reporting Officer* holds all three (`roles-national.csv`).
- **Where it is enforced.** In the module's data set evaluators, so every evaluating REST path
  is covered (`NationalReportPrivilege`). A queued `reportRequest` is evaluated on reporting's
  daemon thread, where every privilege check passes, so the evaluator checks **the user who
  requested the run**. A daemon evaluation that belongs to no request is refused.
- **Stored output.** reporting 2.1.0's `ReportService` has no authorisation of its own, so
  `downloadReport` was guarded by login alone. `StoredReportAccessAdvice` now requires the
  privilege on `loadRenderedOutput`, `loadReportData` and `loadReport` for our reports' requests.
  That covers any request whose report runs our ETL data sets under another UUID too. It fails
  closed when the definition is missing or cannot be read (ADR 0010 amendment A8).

---

## 4. Report REST contract (reportingrest 2.0.0)

These are verified against the `reportingrest-omod` 2.0.0 sources. Every path is under
`/openmrs/ws/rest/v1/`, and all of them need an authenticated session.

| Purpose | Method and path | Source |
| --- | --- | --- |
| List report definitions | `GET reportingrest/reportDefinition?v=full` (or `?q=<name>`) | `ReportDefinitionResource`, `@Resource "v1/reportingrest/reportDefinition"` |
| Get one, with its parameters | `GET reportingrest/reportDefinition/{reportUuid}?v=full` | same |
| List its designs (rendering choices) | `GET reportingrest/reportDesign?reportDefinitionUuid={reportUuid}` | `ReportDesignResource`, `doSearch` |
| Request a run | `POST reportingrest/reportRequest` | `ReportRequestResource`, `@Resource "…/reportRequest"` |
| Poll one request | `GET reportingrest/reportRequest/{requestUuid}` | same |
| List requests | `GET reportingrest/reportRequest?reportDefinition={reportUuid}&status=REQUESTED,PROCESSING,COMPLETED,FAILED` | same, `doSearch` (`sortBy` defaults to priority) |
| Download the rendered output | `GET reportingrest/downloadReport?reportRequestUuid={requestUuid}` | `ReportingRestController` `/downloadReport` |
| Evaluate one data set synchronously (on-screen preview) | `GET reportingrest/reportDataSet/{reportUuid}/indicators?startDate=…&endDate=…&location=…` | `ReportingRestController` `/reportDataSet/{reportDefinitionUuid}/{dataSetKey}` |
| Cancel or remove a request | `DELETE reportingrest/reportRequest/{requestUuid}` | `ReportRequestResource.delete` → `purge` |

### 4.1 Request a run

```json
POST /openmrs/ws/rest/v1/reportingrest/reportRequest
{
  "status": "REQUESTED",
  "priority": "NORMAL",
  "reportDefinition": {
    "parameterizable": { "uuid": "<report UUID>" },
    "parameterMappings": {
      "startDate": "2026-07-01",
      "endDate": "2026-09-30",
      "location": "<location UUID>"
    }
  },
  "renderingMode": { "argument": "<report design UUID>" }
}
```

- **Parameters.** `parameterMappings` values are strings. `ConversionUtil` converts them to
  each parameter's declared type: ISO dates, and a location UUID for a `Location`. A required
  parameter left empty is rejected.
- **Rendering mode.** `renderingMode.argument` is matched against the arguments of
  `ReportService.getRenderingModes(definition)`. For our reports, that is the UUID of the CSV
  or Excel design (§3.1).
- **What happens.** `save()` queues the request and calls `processNextQueuedReports()`. The
  response is the request, with `uuid` and `status`.

### 4.2 Poll and download

- **Status values.** `status` is reporting's `ReportRequest.Status`: `REQUESTED`,
  `SCHEDULED`, `PROCESSING`, `COMPLETED`, `FAILED`, `SCHEDULE_COMPLETED` or `SAVED`.
- **When to stop polling.** Poll until `COMPLETED` or `FAILED`. The timestamps
  `evaluateStartDatetime`, `evaluateCompleteDatetime` and `renderCompleteDatetime` are in the
  default representation.
- **The download.** `downloadReport` returns a `ReportFile` with `filename`, `contentType` and
  `fileContent`. It is built from `renderer.getFilename`, `getRenderedContentType` and
  `loadRenderedOutput`.
  - **To confirm (report UI subtask):** that `fileContent` arrives base64-encoded in JSON, as
    Jackson serialises `byte[]`, before the UI decodes it.
- **`saveReport`.** `POST reportingrest/saveReport?reportRequestUuid=…` is not part of the
  contract.

### 4.3 Also exposed, not part of the contract

reportingrest also exposes these resources. The UI must not use them:

- `reportdata`, which also evaluates XML-serialised definitions that are POSTed to it;
- `dataSet`, `cohort` and `cohortDefinition`;
- `adhocquery` and `adhocdataset`;
- `definitionlibrary`;
- `reportDefinitionsWithScheduledRequests`.

Our privilege check (§3.4) applies wherever our own data set evaluators run.

**Registered SQL only.** Our ETL evaluator also runs only the data sets this module registers,
matched by name **and** exact SQL (`RegisteredEtlDataSets`). The expected SQL is rebuilt from
the report managers' code on every call, not read from the database. So a definition POSTed to
`reportdata` cannot carry its own SQL through it, and neither can a stored definition that
someone with *Manage Report Definitions* has altered.

reporting's own `SqlDataSetDefinition` is outside this module. It stays reachable through
`reportdata`, governed only by reporting's privileges (ADR 0010 amendment A9).

### 4.4 Instance context (`liberiaemrreports`)

`GET /openmrs/ws/rest/v1/liberiaemrreports/context` needs **`Export National Report`** (403
without it, 401 unauthenticated). It tells the UI what it cannot read itself:

```json
{
  "instanceRole": "facility",
  "facilityLocation": { "uuid": "<location UUID>", "display": "<name>" },
  "etlSchema": "liberiaemr_etl",
  "etlLastRun": { "startedAt": "2026-09-27T01:00:00.000+0000", "completedAt": "…", "status": "SUCCESS" }
}
```

- `instanceRole` is `facility` or `central`, after the fail-closed check.
- `facilityLocation` is null at central, and at a facility whose own location does not resolve.
- `etlLastRun` is the latest row of `<etl schema>._mamba_etl_schedule`, or null before the first
  run. `status` is `SUCCESS`, `RUNNING`, `INTERRUPTED` (core closed a stuck run) or `ERROR`.
  - **What counts as a success.** Core's un-stuck procedure relabels a failed or stuck row as
    `SUCCESS`, with the message `Error schedule updated` or `Stuck schedule updated`. So only
    `COMPLETED` + `SUCCESS` + a null message maps to `SUCCESS`; those two messages map to `ERROR`
    and `INTERRUPTED` (`ReportingContextService.status`).
  - **Times.** On a non-`SUCCESS` run, `startedAt` and `completedAt` are the times core wrote
    back, not that run's own.
- This is the one endpoint outside reportingrest that the UI calls. It is read-only, and it
  serves only what the UI cannot read for itself (ADR 0010 amendment A7). **Without it the UI
  runs and exports nothing.** It shows "Reporting context unavailable" instead, because at central
  an absent `location` would mean a national report.

---

## 5. Changing these contracts

Changes to §1's header, a table-naming rule, a report UUID or a parameter name go through the
coordinator. They land here and in ADR 0010 (or a superseding ADR) **before** any code
depends on them. Adding a column to a flat table, or a new fact table, needs no contract
change, only an `sp_makefile` entry in the owner's section.
