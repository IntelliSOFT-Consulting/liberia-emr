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
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.GlobalProperty;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.EtlTestSupport;
import org.openmrs.module.liberiaemrreports.reporting.EtlSqlDataSetDefinition;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.reporting.ReportParameters;
import org.openmrs.module.liberiaemrreports.reporting.ReportRegistrar;
import org.openmrs.module.liberiaemrreports.reporting.UnregisteredDataSetException;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.dataset.DataSet;
import org.openmrs.module.reporting.dataset.DataSetRow;
import org.openmrs.module.reporting.dataset.definition.service.DataSetDefinitionService;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.ReportData;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.definition.service.ReportDefinitionService;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The ETL evaluator runs only the data sets this module registers. reportingrest's {@code reportdata}
 * resource evaluates a definition a caller POSTs, so without this an {@link EtlSqlDataSetDefinition}
 * carrying {@code SELECT patient_id AS <indicator column>} would return patient ids under a name the
 * aggregate-only column check accepts.
 */
public class RegisteredDataSetOnlyTest extends BaseModuleContextSensitiveTest {

	private static final String FACILITY_ONE = "c2a1f754-1594-491a-aff2-6d446c09900f";

	/** The data set name the EMR-Ops report registers its indicators under. */
	private static final String REGISTERED_NAME = ReportSheet.EMR_OPS.getKey() + "-" + LiberiaReportManager.INDICATORS;

	/** Patient-level, behind an alias that looks like an indicator column. */
	private static final String PATIENT_LEVEL_SQL = "SELECT e.patient_id AS MAL_004_NUM\n" //
	        + "FROM encounter e\n" //
	        + "WHERE e.encounter_datetime BETWEEN :startDate AND :endDate\n" //
	        + "  AND e.location_id IN ${scopeLocations}";

	@Autowired
	private LocationScopeResolver locationScopeResolver;

	@Before
	public void setUp() throws Exception {
		EtlTestSupport.createEtlTables(getConnection());
		executeDataSet("LiberiaEMRReportsTestDataset.xml");
		EtlTestSupport.insertHierarchy(getConnection());
		List<LiberiaReportManager> managers = Context.getRegisteredComponents(LiberiaReportManager.class);
		assertEquals(1, managers.size());
		new ReportRegistrar().register(managers.get(0));
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		Context.getAdministrationService()
		        .saveGlobalProperty(new GlobalProperty(LocationScopeResolver.GP_FACILITY_LOCATION, FACILITY_ONE));
	}

	@After
	public void tearDown() {
		locationScopeResolver.setRoleOverride(null);
	}

	private EvaluationContext period() throws Exception {
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");
		EvaluationContext context = new EvaluationContext();
		context.addParameterValue(ReportParameters.START_DATE, day.parse("2026-07-01"));
		context.addParameterValue(ReportParameters.END_DATE, day.parse("2026-09-30"));
		return context;
	}

	private ReportDefinition registered() {
		ReportDefinition rd = Context.getService(ReportDefinitionService.class)
		        .getDefinitionByUuid(ReportSheet.EMR_OPS.getReportUuid());
		assertNotNull(rd);
		return rd;
	}

	private static void assertRefused(Exception thrown) {
		for (Throwable t = thrown; t != null; t = t.getCause()) {
			if (t instanceof UnregisteredDataSetException) {
				return;
			}
		}
		throw new AssertionError("expected an UnregisteredDataSetException in the cause chain of " + thrown, thrown);
	}

	private static List<DataSetRow> rows(DataSet dataSet) {
		List<DataSetRow> rows = new ArrayList<DataSetRow>();
		for (DataSetRow row : dataSet) {
			rows.add(row);
		}
		return rows;
	}

	// ---- refused ----

	@Test
	public void shouldRefuseAnAdHocDefinitionWithPatientLevelSql() throws Exception {
		EtlSqlDataSetDefinition adHoc = new EtlSqlDataSetDefinition("anything", PATIENT_LEVEL_SQL);
		try {
			Context.getService(DataSetDefinitionService.class).evaluate(adHoc, period());
			fail("an ad-hoc definition returned patient ids");
		}
		catch (Exception e) {
			assertRefused(e);
		}
	}

	@Test
	public void shouldRefusePatientLevelSqlUnderTheRegisteredName() throws Exception {
		EtlSqlDataSetDefinition adHoc = new EtlSqlDataSetDefinition(REGISTERED_NAME, PATIENT_LEVEL_SQL);
		try {
			Context.getService(DataSetDefinitionService.class).evaluate(adHoc, period());
			fail("a definition borrowing the registered name returned patient ids");
		}
		catch (Exception e) {
			assertRefused(e);
		}
	}

	/** What reportingrest's {@code reportdata} does with a POSTed report definition. */
	@Test
	public void shouldRefuseAnAdHocReportWrappingIt() throws Exception {
		ReportDefinition adHoc = new ReportDefinition();
		adHoc.setName("ad hoc");
		adHoc.setParameters(ReportParameters.all());
		adHoc.addDataSetDefinition(LiberiaReportManager.INDICATORS,
		    Mapped.mapStraightThrough(new EtlSqlDataSetDefinition(REGISTERED_NAME, PATIENT_LEVEL_SQL)));
		try {
			Context.getService(ReportDefinitionService.class).evaluate(adHoc, period());
			fail("an ad-hoc report returned patient ids");
		}
		catch (Exception e) {
			assertRefused(e);
		}
	}

	/** The copy in the database is not trusted either: the SQL must be what this module's code builds. */
	@Test
	public void shouldRefuseTheRegisteredReportOnceItsStoredSqlIsAltered() throws Exception {
		ReportDefinition rd = registered();
		EtlSqlDataSetDefinition stored = (EtlSqlDataSetDefinition) rd.getDataSetDefinitions()
		        .get(LiberiaReportManager.INDICATORS).getParameterizable();
		stored.setSqlQuery(PATIENT_LEVEL_SQL);
		Context.getService(ReportDefinitionService.class).saveDefinition(rd);
		try {
			Context.getService(ReportDefinitionService.class).evaluate(registered(), period());
			fail("an altered stored definition returned patient ids");
		}
		catch (Exception e) {
			assertRefused(e);
		}
	}

	// ---- still runs ----

	@Test
	public void shouldStillRunTheRegisteredReport() throws Exception {
		ReportData data = Context.getService(ReportDefinitionService.class).evaluate(registered(), period());
		List<DataSetRow> rows = rows(data.getDataSets().get(LiberiaReportManager.INDICATORS));
		assertEquals(1, rows.size());
		assertEquals(4, ((Number) rows.get(0).getColumnValue(EmrOpsReportManager.PLACEHOLDER_COLUMN)).intValue());
	}

	@Test
	public void shouldStillRunTheRegisteredDataSetByItself() throws Exception {
		// reportingrest's reportDataSet/{reportUuid}/indicators preview path
		EtlSqlDataSetDefinition dsd = (EtlSqlDataSetDefinition) registered().getDataSetDefinitions()
		        .get(LiberiaReportManager.INDICATORS).getParameterizable();
		assertEquals(REGISTERED_NAME, dsd.getName());
		assertEquals(EmrOpsReportManager.PLACEHOLDER_SQL, dsd.getSqlQuery());
		List<DataSetRow> rows = rows(Context.getService(DataSetDefinitionService.class).evaluate(dsd, period()));
		assertEquals(1, rows.size());
		assertTrue(rows.get(0).getColumnValue(EmrOpsReportManager.PLACEHOLDER_COLUMN) instanceof Number);
	}
}
