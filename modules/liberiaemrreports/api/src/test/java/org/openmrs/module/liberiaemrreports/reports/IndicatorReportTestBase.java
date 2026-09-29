/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reports;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.junit.After;
import org.junit.Before;
import org.openmrs.GlobalProperty;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.EtlTestSupport;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.reporting.ReportParameters;
import org.openmrs.module.liberiaemrreports.reporting.ReportRegistrar;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.dataset.DataSet;
import org.openmrs.module.reporting.dataset.DataSetColumn;
import org.openmrs.module.reporting.dataset.DataSetRow;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.report.ReportData;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.definition.service.ReportDefinitionService;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Runs a sheet's registered report over rows a test loads into the stand-in ETL schema
 * ({@link EtlTestSupport}), in facility or central mode, and reads its data sets back by column
 * name. Locations are those of {@code LiberiaEMRReportsTestDataset.xml}: facility one (103) with its
 * OPD (104) and facility two (105), in one district (102) and county (101).
 */
public abstract class IndicatorReportTestBase extends BaseModuleContextSensitiveTest {

	protected static final int F1 = 103;

	protected static final int F1_OPD = 104;

	protected static final int F2 = 105;

	protected static final String Q3_START = "2026-07-01";

	protected static final String Q3_END = "2026-09-30";

	@Autowired
	protected LocationScopeResolver locationScopeResolver;

	@Before
	public void setUpEtl() throws Exception {
		EtlTestSupport.createEtlTables(getConnection());
		executeDataSet("LiberiaEMRReportsTestDataset.xml");
		EtlTestSupport.insertHierarchy(getConnection());
		Context.getAdministrationService().saveGlobalProperty(
		    new GlobalProperty(LocationScopeResolver.GP_FACILITY_LOCATION, EtlTestSupport.FACILITY_ONE));
		asRole(InstanceRole.FACILITY);
	}

	@After
	public void clearRole() {
		locationScopeResolver.setRoleOverride(null);
	}

	/**
	 * Pins the role and re-registers every report, as a restart would: a report's stored SQL must be
	 * what its manager builds for the running role.
	 */
	protected void asRole(InstanceRole role) {
		locationScopeResolver.setRoleOverride(role);
		List<LiberiaReportManager> managers = Context.getRegisteredComponents(LiberiaReportManager.class);
		assertEquals("one report per sheet", ReportSheet.values().length, managers.size());
		for (LiberiaReportManager manager : managers) {
			new ReportRegistrar().register(manager);
		}
	}

	/** Inserts rows into an ETL table: {@code into} is the table and its column list. */
	protected void etl(String into, String... valueTuples) throws Exception {
		for (String values : valueTuples) {
			EtlTestSupport.execute(getConnection(), "INSERT INTO " + EtlTestSupport.SCHEMA + "." + into + " VALUES " + values);
		}
	}

	/** A person with a birthdate, a gender and, unless given, their own person key. */
	protected void person(int id, String birthdate, String gender, String personKey) throws Exception {
		etl("mamba_dim_person (person_id, birthdate, gender)", "(" + id + ", '" + birthdate + "', '" + gender + "')");
		etl("mamba_dim_person_cpi (person_id, person_key)", "(" + id + ", '" + personKey + "')");
	}

	protected void person(int id, String birthdate, String gender) throws Exception {
		person(id, birthdate, gender, "patient:" + id);
	}

	protected static ReportDefinition registered(ReportSheet sheet) {
		ReportDefinition rd = Context.getService(ReportDefinitionService.class).getDefinitionByUuid(sheet.getReportUuid());
		assertNotNull(sheet + " was not registered", rd);
		return rd;
	}

	protected static EvaluationContext context(String start, String end, String locationUuid) throws Exception {
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");
		EvaluationContext context = new EvaluationContext();
		context.addParameterValue(ReportParameters.START_DATE, day.parse(start));
		context.addParameterValue(ReportParameters.END_DATE, day.parse(end));
		if (locationUuid != null) {
			context.addParameterValue(ReportParameters.LOCATION,
			    Context.getLocationService().getLocationByUuid(locationUuid));
		}
		return context;
	}

	protected static ReportData evaluate(ReportSheet sheet, String start, String end, String locationUuid)
	        throws Exception {
		return Context.getService(ReportDefinitionService.class).evaluate(registered(sheet),
		    context(start, end, locationUuid));
	}

	/** The one row of the indicators data set, by column name, ignoring case. */
	protected static Map<String, Object> indicators(ReportSheet sheet, String start, String end, String locationUuid)
	        throws Exception {
		List<Map<String, Object>> rows = rows(
		    evaluate(sheet, start, end, locationUuid).getDataSets().get(LiberiaReportManager.INDICATORS));
		assertEquals("an indicators data set has one row", 1, rows.size());
		return rows.get(0);
	}

	protected static Map<String, Object> q3(ReportSheet sheet, String locationUuid) throws Exception {
		return indicators(sheet, Q3_START, Q3_END, locationUuid);
	}

	/** The rows of the by_facility data set, which a central instance adds. */
	protected static List<Map<String, Object>> byFacility(ReportSheet sheet, String start, String end, String locationUuid)
	        throws Exception {
		DataSet dataSet = evaluate(sheet, start, end, locationUuid).getDataSets().get(LiberiaReportManager.BY_FACILITY);
		assertNotNull("central adds the by_facility data set", dataSet);
		return rows(dataSet);
	}

	protected static List<Map<String, Object>> rows(DataSet dataSet) {
		List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
		for (DataSetRow row : dataSet) {
			Map<String, Object> values = new TreeMap<String, Object>(String.CASE_INSENSITIVE_ORDER);
			for (Map.Entry<DataSetColumn, Object> cell : row.getColumnValues().entrySet()) {
				values.put(cell.getKey().getName(), cell.getValue());
			}
			rows.add(values);
		}
		return rows;
	}

	/** Asserts a count column. */
	protected static void assertCount(Map<String, Object> row, String column, int expected) {
		Object value = row.get(column);
		assertTrue(column + " should be a number, got " + value, value instanceof Number);
		assertEquals(column, expected, ((Number) value).intValue());
	}

	/** Asserts a percentage column to 0.05, or its absence (null) when {@code expected} is null. */
	protected static void assertPercent(Map<String, Object> row, String column, Double expected) {
		Object value = row.get(column);
		if (expected == null) {
			assertNull(column + " should be empty", value);
			return;
		}
		assertTrue(column + " should be a number, got " + value, value instanceof Number);
		assertEquals(column, expected, ((Number) value).doubleValue(), 0.05);
	}

	/** Asserts NUM, DEN and PCT of a code, e.g. {@code MAL_002}. */
	protected static void assertRatio(Map<String, Object> row, String code, int num, int den, Double pct) {
		assertCount(row, code + "_NUM", num);
		assertCount(row, code + "_DEN", den);
		assertPercent(row, code + "_PCT", pct);
	}

	/**
	 * At central, each by_facility row equals the indicators of a run scoped to that facility, column
	 * for column, and a numerator-only row has no _DEN column.
	 */
	protected void assertByFacilityMatchesFacilityRuns(ReportSheet sheet, String start, String end) throws Exception {
		asRole(InstanceRole.CENTRAL);
		List<Map<String, Object>> rows = byFacility(sheet, start, end, null);
		assertEquals("a row per facility", 2, rows.size());
		for (Map<String, Object> row : rows) {
			Map<String, Object> run = indicators(sheet, start, end, (String) row.get("facility_uuid"));
			for (Map.Entry<String, Object> cell : run.entrySet()) {
				assertSameValue(row.get("facility_name") + " " + cell.getKey(), cell.getValue(), row.get(cell.getKey()));
			}
		}
	}

	/**
	 * A facility's report equals central's report scoped to that facility, when both hold the same
	 * rows: the consistency rule of ADR 0010 decision 5.
	 */
	protected void assertFacilityEqualsCentralForIt(ReportSheet sheet, String start, String end, String... columns)
	        throws Exception {
		asRole(InstanceRole.FACILITY);
		Map<String, Object> atFacility = indicators(sheet, start, end, null);
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> atCentral = indicators(sheet, start, end, EtlTestSupport.FACILITY_ONE);
		for (String column : columns.length == 0 ? atFacility.keySet().toArray(new String[0]) : columns) {
			assertSameValue(column, atFacility.get(column), atCentral.get(column));
		}
	}

	private static void assertSameValue(String what, Object expected, Object actual) {
		if (expected == null || actual == null) {
			assertEquals(what, expected, actual);
		} else {
			assertEquals(what, ((Number) expected).doubleValue(), ((Number) actual).doubleValue(), 0.0001);
		}
	}
}
