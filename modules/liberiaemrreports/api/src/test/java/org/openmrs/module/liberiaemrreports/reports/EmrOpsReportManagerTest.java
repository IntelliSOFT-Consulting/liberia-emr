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

import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.GlobalProperty;
import org.openmrs.Location;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.EtlTestSupport;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.reporting.ReportParameters;
import org.openmrs.module.liberiaemrreports.reporting.ReportRegistrar;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.scope.ReportScopeException;
import org.openmrs.module.liberiaemrreports.security.StoredReportAccessAdvice;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.dataset.DataSet;
import org.openmrs.module.reporting.dataset.DataSetRow;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;
import org.openmrs.module.reporting.report.ReportData;
import org.openmrs.module.reporting.report.ReportDesign;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.definition.service.ReportDefinitionService;
import org.openmrs.module.reporting.report.renderer.CsvReportRenderer;
import org.openmrs.module.reporting.report.renderer.XlsReportRenderer;
import org.openmrs.module.reporting.report.service.ReportService;
import org.openmrs.module.reporting.report.service.ReportServiceImpl;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The placeholder EMR-Ops report registers under its fixed UUIDs and evaluates, in facility and
 * central mode, over a stand-in ETL location hierarchy. Expected counts are in
 * LiberiaEMRReportsTestDataset.xml.
 */
public class EmrOpsReportManagerTest extends BaseModuleContextSensitiveTest {
	
	private static final String FACILITY_ONE = "c2a1f754-1594-491a-aff2-6d446c09900f";
	
	private static final String FACILITY_ONE_OPD = "ed80f7c1-dd08-4685-9afc-b18029365609";
	
	private static final String FACILITY_TWO = "9fcc83b6-2574-4f8e-ae92-724d7d5eeeb3";
	
	private static final String DISTRICT = "ed8cc084-5cb5-46c2-bd13-58889ef22ffd";
	
	private static final String COUNTY = "13cf7f2f-aa51-4daf-a895-adb964720986";
	
	@Autowired
	private LocationScopeResolver locationScopeResolver;
	
	@Before
	public void setUp() throws Exception {
		EtlTestSupport.createEtlTables(getConnection());
		executeDataSet("LiberiaEMRReportsTestDataset.xml");
		EtlTestSupport.insertHierarchy(getConnection());
		// register() rather than registerAll(), so that a failure fails the test instead of being logged
		List<LiberiaReportManager> managers = Context.getRegisteredComponents(LiberiaReportManager.class);
		assertEquals("exactly the placeholder report is registered", 1, managers.size());
		new ReportRegistrar().register(managers.get(0));
	}
	
	@After
	public void tearDown() {
		locationScopeResolver.setRoleOverride(null);
	}
	
	private ReportDefinition registered() {
		ReportDefinition rd = Context.getService(ReportDefinitionService.class)
		        .getDefinitionByUuid(ReportSheet.EMR_OPS.getReportUuid());
		assertNotNull("the EMR-Ops report was not registered", rd);
		return rd;
	}
	
	private void facilityIs(String uuid) {
		Context.getAdministrationService()
		        .saveGlobalProperty(new GlobalProperty(LocationScopeResolver.GP_FACILITY_LOCATION, uuid));
	}
	
	private EvaluationContext period(String locationUuid) throws Exception {
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");
		EvaluationContext context = new EvaluationContext();
		context.addParameterValue(ReportParameters.START_DATE, day.parse("2026-07-01"));
		context.addParameterValue(ReportParameters.END_DATE, day.parse("2026-09-30"));
		if (locationUuid != null) {
			context.addParameterValue(ReportParameters.LOCATION,
			    Context.getLocationService().getLocationByUuid(locationUuid));
		}
		return context;
	}
	
	private int count(EvaluationContext context) throws Exception {
		ReportData data = Context.getService(ReportDefinitionService.class).evaluate(registered(), context);
		DataSet dataSet = data.getDataSets().get(LiberiaReportManager.INDICATORS);
		List<DataSetRow> rows = new ArrayList<DataSetRow>();
		for (DataSetRow row : dataSet) {
			rows.add(row);
		}
		assertEquals("an aggregate data set has one row", 1, rows.size());
		Object value = rows.get(0).getColumnValue(EmrOpsReportManager.PLACEHOLDER_COLUMN);
		assertTrue("a plain number, got " + value, value instanceof Number);
		return ((Number) value).intValue();
	}
	
	private static <T extends Throwable> T causedBy(Throwable thrown, Class<T> type) {
		for (Throwable t = thrown; t != null; t = t.getCause()) {
			if (type.isInstance(t)) {
				return type.cast(t);
			}
		}
		throw new AssertionError("expected a " + type.getSimpleName() + " in the cause chain of " + thrown, thrown);
	}
	
	// ---- registration ----
	
	@Test
	public void shouldRegisterUnderTheFixedUuidsWithTheStandardParametersAndBothDesigns() {
		ReportDefinition rd = registered();
		assertEquals("MOH EMR Operational Indicators", rd.getName());
		List<String> names = new ArrayList<String>();
		for (Parameter p : rd.getParameters()) {
			names.add(p.getName());
		}
		assertEquals(ReportParameters.START_DATE + "," + ReportParameters.END_DATE + "," + ReportParameters.LOCATION,
		    String.join(",", names));
		assertTrue(rd.getDataSetDefinitions().containsKey(LiberiaReportManager.INDICATORS));
		
		ReportService rs = Context.getService(ReportService.class);
		ReportDesign csv = rs.getReportDesignByUuid(ReportSheet.EMR_OPS.getCsvDesignUuid());
		ReportDesign xlsx = rs.getReportDesignByUuid(ReportSheet.EMR_OPS.getExcelDesignUuid());
		assertEquals(CsvReportRenderer.class, csv.getRendererType());
		assertEquals(XlsReportRenderer.class, xlsx.getRendererType());
		assertEquals(2, rs.getReportDesigns(rd, null, true).size());
	}
	
	@Test
	public void shouldBeIdempotentAcrossRestarts() {
		Integer id = registered().getId();
		new ReportRegistrar().registerAll();
		new ReportRegistrar().registerAll();
		ReportDefinition rd = registered();
		assertEquals(id, rd.getId());
		assertEquals(2, Context.getService(ReportService.class).getReportDesigns(rd, null, true).size());
	}
	
	// ---- facility ----
	
	@Test
	public void facility_shouldCountItselfAndItsSubLocationsByDefault() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		facilityIs(FACILITY_ONE);
		// 9001, 9002 at the OPD, 9003 at the facility (the last minute of the period), and 9005
		// through its visit. Not 9006 (voided) or 9007 (before the period).
		assertEquals(4, count(period(null)));
		assertEquals(4, count(period(FACILITY_ONE)));
		assertEquals(2, count(period(FACILITY_ONE_OPD)));
	}
	
	@Test
	public void facility_shouldRefuseAnotherFacilityOrAWiderArea() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		facilityIs(FACILITY_ONE);
		for (String outside : new String[] { FACILITY_TWO, DISTRICT, COUNTY }) {
			try {
				count(period(outside));
				fail("facility one reported on " + outside);
			}
			catch (Exception e) {
				causedBy(e, ReportScopeException.class);
			}
		}
	}
	
	@Test
	public void facility_shouldFailWithoutItsOwnLocation() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		facilityIs("");
		try {
			count(period(null));
			fail("a facility without a location ran a report");
		}
		catch (Exception e) {
			causedBy(e, ReportScopeException.class);
		}
	}
	
	// ---- central ----
	
	@Test
	public void central_shouldRollUpThroughTheHierarchy() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.CENTRAL);
		facilityIs(FACILITY_ONE); // ignored at central
		assertEquals(5, count(period(null)));
		assertEquals(5, count(period(COUNTY)));
		assertEquals(5, count(period(DISTRICT)));
		assertEquals(4, count(period(FACILITY_ONE)));
		assertEquals(1, count(period(FACILITY_TWO)));
	}
	
	@Test
	public void central_shouldEqualTheFacilityForThatFacility() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		facilityIs(FACILITY_ONE);
		int atFacility = count(period(null));
		locationScopeResolver.setRoleOverride(InstanceRole.CENTRAL);
		assertEquals(atFacility, count(period(FACILITY_ONE)));
	}
	
	// ---- privilege ----
	
	@Test
	public void shouldRefuseAUserWithoutExportNationalReport() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.CENTRAL);
		EvaluationContext context = period(null);
		Context.becomeUser("butch");
		try {
			count(context);
			fail("a user without Export National Report evaluated the report");
		}
		catch (Exception e) {
			causedBy(e, APIAuthenticationException.class);
		}
	}
	
	@Test
	public void shouldRefuseAQueuedRequestFromAUserWithoutExportNationalReport() throws Exception {
		locationScopeResolver.setRoleOverride(InstanceRole.CENTRAL);
		ReportRequest request = request(Context.getUserService().getUserByUsername("butch"));
		EvaluationContext context = period(null);
		context.addContextValue(ReportServiceImpl.REPORT_REQUEST_UUID, request.getUuid());
		try {
			count(context); // evaluated by admin, but on butch's behalf
			fail("a request from a user without Export National Report was evaluated");
		}
		catch (Exception e) {
			causedBy(e, APIAuthenticationException.class);
		}
	}
	
	@Test
	public void storedOutput_shouldRequireExportNationalReportForOurReportsOnly() throws Exception {
		Method load = ReportService.class.getMethod("loadRenderedOutput", ReportRequest.class);
		StoredReportAccessAdvice advice = new StoredReportAccessAdvice();
		ReportRequest ours = request(Context.getAuthenticatedUser());
		ReportRequest theirs = new ReportRequest();
		ReportDefinition other = new ReportDefinition();
		other.setUuid("not-a-liberiaemr-report");
		theirs.setReportDefinition(Mapped.noMappings(other));
		
		advice.before(load, new Object[] { ours }, null); // admin may
		
		Context.becomeUser("butch");
		advice.before(load, new Object[] { theirs }, null); // not ours: reporting's rules apply
		try {
			advice.before(load, new Object[] { ours }, null);
			fail("butch read a stored national report");
		}
		catch (APIAuthenticationException expected) {
			// the guard held
		}
	}
	
	private ReportRequest request(org.openmrs.User requestedBy) {
		ReportRequest request = new ReportRequest();
		request.setReportDefinition(Mapped.noMappings(registered()));
		request.setRequestedBy(requestedBy);
		request.setStatus(ReportRequest.Status.COMPLETED);
		return Context.getService(ReportService.class).saveReportRequest(request);
	}
	
	@Test
	public void location_shouldBeAnOptionalLocationParameter() {
		Parameter location = registered().getParameter(ReportParameters.LOCATION);
		assertEquals(Location.class, location.getType());
		assertEquals(false, location.isRequired());
	}
}
