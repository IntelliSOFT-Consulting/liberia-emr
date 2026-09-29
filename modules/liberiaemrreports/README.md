# liberiaemrreports

The MOH indicator reports: one aggregate report per workbook sheet, evaluated over this
instance's own Mamba ETL schema and served through reportingrest 2.0.0. The design is
[ADR 0010](../../docs/adr/0010-indicator-reporting-mamba-etl.md) decisions 5 to 7; the contracts
(names, parameters, columns, REST) are [`docs/reporting/README.md`](../../docs/reporting/README.md)
§3 and §4.

- **Requires** `reporting` 2.1.0 and `reportingrest` 2.0.0. **Aware of** the ETL module
  (`mambaEtlModulePackage` in `pom.xml`); it never loads an ETL class and has no mamba-core
  dependency.
- **Built** from source in the backend image's module stage, like `liberiaemr`, and never listed
  in `distro.properties`. `mvn -f modules/liberiaemrreports clean package` builds and tests it.

## How a report works

| Piece | Where |
| --- | --- |
| Report and design UUIDs | `var.report.<sheet>.uuid`, `var.reportdesign.<sheet>-{csv,xlsx}.uuid` in `content-liberia-national/configuration/variables.properties`, filtered into `liberiaemrreports-uuids.properties`. No UUID in Java. |
| Registration | Every `@Component` subclass of `LiberiaReportManager` is re-saved under its fixed UUIDs on each start (`ReportRegistrar`). |
| ETL schema | `${etl}` in SQL, from `mambaetl.analysis.db.etl_database`, default `liberiaemr_etl` (`EtlSchema`). |
| Location | `${scopeLocations}` in SQL: facility clamped to `liberiaemr.facility.locationUuid`, any node rolled up to all of its descendants through `mamba_dim_location_ancestor` (`LocationScope`, `LocationScopeResolver`). The role is `LIBERIAEMR_INSTANCE_ROLE`, failing closed to `facility`. |
| Privilege | `Export National Report`, in the data set evaluator (every evaluating path) and on stored output (`StoredReportAccessAdvice`, for `downloadReport`). |
| Registered SQL only | The evaluator runs a data set only if its name and exact SQL are what one of these managers builds (`RegisteredEtlDataSets`). reportingrest's `reportdata` evaluates POSTed definitions, so an ad-hoc or altered `EtlSqlDataSetDefinition` is refused before any SQL runs. |
| Aggregates only | The evaluator also refuses person- or record-identifying column names and any cell that is not a number, text or date. That catches a mistake in our own SQL; it is no defence against a hostile alias, which the registration check is. |
| UI context | `GET /ws/rest/v1/liberiaemrreports/context`: role, own facility, last ETL run. |

## The sheets

One `@Component` manager per sheet, in `reports/`. Each report's description carries its notes:
the disaggregations the workbook asks for that the EMR does not capture, and the rows returned as
numerator only.

| Manager | Rows | Reads |
| --- | --- | --- |
| `RmncahReportManager` | RMNCAH-017, 018, 019, 020, 021, 026, 028 | `mamba_fact_rmncah_family_planning`, `_delivery`, `_mother_pnc`; `mamba_fact_malaria_diagnosis` and `_drug` |
| `NutritionReportManager` | NUT-005, 008, 009 | `mamba_fact_nutrition_vitamin_a`, `_anthropometry` |
| `MalariaReportManager` | MAL-002, 003, 004 | `mamba_fact_rmncah_anc_visit`, `mamba_fact_malaria_lab_result` |
| `NcdReportManager` | NCD-002, 005, 007, 011, 015 | `mamba_fact_ncd_death`, `_blood_pressure`; `mamba_fact_malaria_diagnosis`, `_lab_result` |
| `EmrOpsReportManager` | EMR-OPS-007, 008, 015 | `mamba_fact_emr_ops_patient`, `_visit`; `mamba_dim_encounter`, `mamba_dim_emr_ops_encounter_type` |

People are counted with `mamba_dim_person_cpi.person_key`, so at central a person with records
at two facilities counts once; ages come from core's `mamba_dim_person`. The definitions, episode
windows and edge cases are those `qa/reporting/README.md` adopts. EMR-OPS-007 and 015 have a
facility and a central definition in the matrix, so their SQL follows the instance role.

## Adding an indicator

Write it as an `IndicatorQuery` in its sheet's manager and add it to the manager's `queries()`.
The query is written once, against a `Grouping`, and gives both data sets: `indicators` (one row
for the scope) and, at central, `by_facility` (one row per Health Facility in scope, with
`facility_name` and `facility_uuid`). Use `IndicatorSql` for the column names and aggregates,
`Disaggregation` for suffixes, and the `Grouping` methods for the location filter:

```java
static IndicatorQuery confirmedCases() {
	String num = column("MAL-004", "NUM");
	return IndicatorQuery.of(g -> IndicatorQuery.select(g, "r.facility_location_id",
	    Arrays.asList(IndicatorSql.count(num, "1 = 1")),
	    "FROM ${etl}.mamba_fact_malaria_lab_result r ...\n"
	            + "WHERE r.is_malaria_positive = 1\n"
	            + "  AND r.resulted_at BETWEEN :startDate AND :endDate\n"
	            + "  AND " + g.inScope("r") + "\n"
	            + "  AND NOT EXISTS (SELECT 1 FROM ... q WHERE ... AND " + g.inSameScope("q", "r") + " ...)"),
	    num);
}
```

- `g.inScope(alias)` is the location filter; never write your own.
- `g.inSameScope(inner, outer)` in a correlated lookup (a latest reading, an earlier diagnosis in
  the same episode, a first-ever diagnosis): by facility it also ties the lookup to the counted
  row's facility, so each `by_facility` row equals a run scoped to that facility.
- Coded logic stays in the ETL: compare fact columns, never a UUID.

Then load rows for it in the sheet's test (`IndicatorReportTestBase` creates the stand-in ETL
tables of `EtlTestSupport`) and assert each column in facility and central mode.
`IndicatorContractTest` checks every sheet's column names and that its SQL reads only `${etl}`
tables and holds no UUID. On a stack, `qa/reporting/compare-reports.py` compares the reports with
`qa/reporting/expected-values.csv`.
