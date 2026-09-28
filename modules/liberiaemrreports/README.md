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
| Location | `${scopeLocations}` in SQL: facility clamped to `liberiaemr.facility.locationUuid`, central rolled up through `mamba_dim_location_hierarchy` (`LocationScopeResolver`). The role is `LIBERIAEMR_INSTANCE_ROLE`, failing closed to `facility`. |
| Privilege | `Export National Report`, in the data set evaluator (every evaluating path) and on stored output (`StoredReportAccessAdvice`, for `downloadReport`). |
| Registered SQL only | The evaluator runs a data set only if its name and exact SQL are what one of these managers builds (`RegisteredEtlDataSets`). reportingrest's `reportdata` evaluates POSTed definitions, so an ad-hoc or altered `EtlSqlDataSetDefinition` is refused before any SQL runs. |
| Aggregates only | The evaluator also refuses person- or record-identifying column names and any cell that is not a number, text or date. That catches a mistake in our own SQL; it is no defence against a hostile alias, which the registration check is. |
| UI context | `GET /ws/rest/v1/liberiaemrreports/context`: role, own facility, last ETL run. |

## Adding a sheet's indicators

Edit the sheet's manager (`EmrOpsReportManager` is the placeholder for EMR-Ops) or add one per
sheet. Use `IndicatorSql` for the column names and aggregates, and `Disaggregation` for sex and
age bands:

```java
@Component
public class MalariaReportManager extends LiberiaReportManager {

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.MALARIA;
	}

	@Override
	protected List<String> getNotes() {
		return Collections.singletonList("MAL-004: age band not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition rd) {
		String tested = "f.tested = 1", positive = "f.tested = 1 AND f.positive = 1";
		List<String> columns = new ArrayList<String>();
		columns.addAll(IndicatorSql.disaggregated(IndicatorSql.column("MAL-004", "NUM"), null, positive,
		    Disaggregation.sex("f.gender")));
		columns.add(IndicatorSql.count(IndicatorSql.column("MAL-004", "DEN"), tested));
		columns.add(IndicatorSql.percent(IndicatorSql.column("MAL-004", "PCT"),
		    "SUM(CASE WHEN " + positive + " THEN 1 ELSE 0 END)", "SUM(CASE WHEN " + tested + " THEN 1 ELSE 0 END)"));
		addDataSet(rd, INDICATORS, IndicatorSql.select(columns,
		    "FROM ${etl}.mamba_fact_malaria_test f\n"
		            + "WHERE f.encounter_datetime BETWEEN :startDate AND :endDate\n"
		            + "  AND f.location_id IN ${scopeLocations}"));
	}
}
```

Then add a context-sensitive test beside `EmrOpsReportManagerTest`: create the fact table in
`EtlTestSupport`, load rows, and assert each column in facility and central mode.
