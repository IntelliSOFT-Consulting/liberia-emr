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
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.COUNTY;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.DISTRICT;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_ONE;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_ONE_OPD;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_TWO;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import org.junit.Test;
import org.openmrs.GlobalProperty;
import org.openmrs.Location;
import org.openmrs.User;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.LiberiaEMRReportsActivator;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.reporting.ReportParameters;
import org.openmrs.module.liberiaemrreports.reporting.ReportRegistrar;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.scope.ReportScopeException;
import org.openmrs.module.liberiaemrreports.security.StoredReportAccessAdvice;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.dataset.definition.SqlDataSetDefinition;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;
import org.openmrs.module.reporting.report.ReportDesign;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.definition.service.ReportDefinitionService;
import org.openmrs.module.reporting.report.renderer.CsvReportRenderer;
import org.openmrs.module.reporting.report.renderer.XlsReportRenderer;
import org.openmrs.module.reporting.report.service.ReportService;
import org.openmrs.module.reporting.report.service.ReportServiceImpl;

/**
 * What every sheet shares: registration under the fixed UUIDs, the facility clamp and central
 * roll-up, the privilege, and the central-only by_facility data set. The probe is EMR-OPS-008's
 * denominator, the live clinical encounters of LiberiaEMRReportsTestDataset.xml in Q3 2026.
 */
public class ReportFrameworkTest extends IndicatorReportTestBase {

	private static final String PROBE = "EMR_OPS_008_DEN";

	private void facilityIs(String uuid) {
		Context.getAdministrationService()
		        .saveGlobalProperty(new GlobalProperty(LocationScopeResolver.GP_FACILITY_LOCATION, uuid));
	}

	private static int probe(EvaluationContext context) throws Exception {
		ReportDefinition rd = registered(ReportSheet.EMR_OPS);
		Object value = rows(Context.getService(ReportDefinitionService.class).evaluate(rd, context).getDataSets()
		        .get(LiberiaReportManager.INDICATORS)).get(0).get(PROBE);
		assertTrue("a plain number, got " + value, value instanceof Number);
		return ((Number) value).intValue();
	}

	private static int probe(String locationUuid) throws Exception {
		return probe(context(Q3_START, Q3_END, locationUuid));
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
	public void shouldRegisterEverySheetUnderItsFixedUuidsWithTheStandardParametersAndBothDesigns() {
		ReportService rs = Context.getService(ReportService.class);
		for (ReportSheet sheet : ReportSheet.values()) {
			ReportDefinition rd = registered(sheet);
			assertEquals(sheet.getReportName(), rd.getName());
			List<String> names = new ArrayList<String>();
			for (Parameter p : rd.getParameters()) {
				names.add(p.getName());
			}
			assertEquals(ReportParameters.START_DATE + "," + ReportParameters.END_DATE + "," + ReportParameters.LOCATION,
			    String.join(",", names));
			assertTrue(rd.getDataSetDefinitions().containsKey(LiberiaReportManager.INDICATORS));
			assertTrue(sheet + " describes what it cannot disaggregate", rd.getDescription().contains("\n"));

			ReportDesign csv = rs.getReportDesignByUuid(sheet.getCsvDesignUuid());
			ReportDesign xlsx = rs.getReportDesignByUuid(sheet.getExcelDesignUuid());
			assertEquals(CsvReportRenderer.class, csv.getRendererType());
			assertEquals(XlsReportRenderer.class, xlsx.getRendererType());
			assertEquals(2, rs.getReportDesigns(rd, null, true).size());
		}
	}

	@Test
	public void shouldBeIdempotentAcrossRestarts() {
		Integer id = registered(ReportSheet.EMR_OPS).getId();
		new ReportRegistrar().registerAll();
		new ReportRegistrar().registerAll();
		ReportDefinition rd = registered(ReportSheet.EMR_OPS);
		assertEquals(id, rd.getId());
		assertEquals(2, Context.getService(ReportService.class).getReportDesigns(rd, null, true).size());
	}

	@Test
	public void shouldRegisterOnModuleStart() {
		Integer id = registered(ReportSheet.NCD).getId();
		LiberiaEMRReportsActivator activator = new LiberiaEMRReportsActivator();
		activator.started();
		assertEquals(id, registered(ReportSheet.NCD).getId());
		activator.stopped();
	}

	@Test
	public void location_shouldBeAnOptionalLocationParameter() {
		Parameter location = registered(ReportSheet.RMNCAH).getParameter(ReportParameters.LOCATION);
		assertEquals(Location.class, location.getType());
		assertFalse(location.isRequired());
	}

	@Test
	public void byFacility_shouldBeCentralOnly() {
		for (ReportSheet sheet : ReportSheet.values()) {
			assertFalse(registered(sheet).getDataSetDefinitions().containsKey(LiberiaReportManager.BY_FACILITY));
		}
		asRole(InstanceRole.CENTRAL);
		for (ReportSheet sheet : ReportSheet.values()) {
			assertTrue(registered(sheet).getDataSetDefinitions().containsKey(LiberiaReportManager.BY_FACILITY));
		}
	}

	// ---- facility ----

	@Test
	public void facility_shouldCountItselfAndItsSubLocationsByDefault() throws Exception {
		// 9001, 9002 at the OPD, 9003 at the facility (the last minute of the period), and 9005
		// through its visit. Not 9006 (voided) or 9007 (before the period).
		assertEquals(4, probe((String) null));
		assertEquals(4, probe(FACILITY_ONE));
		assertEquals(2, probe(FACILITY_ONE_OPD));
	}

	@Test
	public void facility_shouldRefuseAnotherFacilityOrAWiderArea() throws Exception {
		for (String outside : new String[] { FACILITY_TWO, DISTRICT, COUNTY }) {
			EvaluationContext context = context(Q3_START, Q3_END, outside);
			causedBy(assertThrows(Exception.class, () -> probe(context)), ReportScopeException.class);
		}
	}

	@Test
	public void facility_shouldFailWithoutItsOwnLocation() throws Exception {
		facilityIs("");
		EvaluationContext context = context(Q3_START, Q3_END, null);
		causedBy(assertThrows(Exception.class, () -> probe(context)), ReportScopeException.class);
	}

	// ---- central ----

	@Test
	public void central_shouldRollUpThroughTheHierarchy() throws Exception {
		asRole(InstanceRole.CENTRAL);
		facilityIs(FACILITY_ONE); // ignored at central
		assertEquals(5, probe((String) null));
		assertEquals(5, probe(COUNTY));
		assertEquals(5, probe(DISTRICT));
		assertEquals(4, probe(FACILITY_ONE));
		assertEquals(1, probe(FACILITY_TWO));
	}

	@Test
	public void central_byFacilityShouldListEachFacilityInScope() throws Exception {
		asRole(InstanceRole.CENTRAL);
		List<java.util.Map<String, Object>> rows = byFacility(ReportSheet.EMR_OPS, Q3_START, Q3_END, DISTRICT);
		assertEquals(2, rows.size());
		assertEquals("Test Facility One", rows.get(0).get("facility_name"));
		assertEquals(FACILITY_ONE, rows.get(0).get("facility_uuid"));
		assertCount(rows.get(0), PROBE, 4);
		assertEquals("Test Facility Two", rows.get(1).get("facility_name"));
		assertCount(rows.get(1), PROBE, 1);

		rows = byFacility(ReportSheet.EMR_OPS, Q3_START, Q3_END, FACILITY_TWO);
		assertEquals(1, rows.size());
		// a facility with no events has zero counts and no value
		rows = byFacility(ReportSheet.MALARIA, Q3_START, Q3_END, FACILITY_TWO);
		assertCount(rows.get(0), "MAL_002_NUM", 0);
		assertPercent(rows.get(0), "MAL_002_PCT", null);
	}

	// ---- privilege ----

	@Test
	public void shouldRefuseAUserWithoutExportNationalReport() throws Exception {
		asRole(InstanceRole.CENTRAL);
		EvaluationContext context = context(Q3_START, Q3_END, null);
		Context.becomeUser("butch");
		causedBy(assertThrows(Exception.class, () -> probe(context)), APIAuthenticationException.class);
	}

	@Test
	public void shouldRefuseAQueuedRequestFromAUserWithoutExportNationalReport() throws Exception {
		asRole(InstanceRole.CENTRAL);
		ReportRequest request = request(Context.getUserService().getUserByUsername("butch"));
		EvaluationContext context = context(Q3_START, Q3_END, null);
		context.addContextValue(ReportServiceImpl.REPORT_REQUEST_UUID, request.getUuid());
		// evaluated by admin, but on butch's behalf
		causedBy(assertThrows(Exception.class, () -> probe(context)), APIAuthenticationException.class);
	}

	@Test
	public void storedOutput_shouldRequireExportNationalReportForOurReportsOnly() throws Exception {
		Method load = ReportService.class.getMethod("loadRenderedOutput", ReportRequest.class);
		StoredReportAccessAdvice advice = new StoredReportAccessAdvice();
		ReportRequest ours = request(Context.getAuthenticatedUser());
		ReportRequest theirs = new ReportRequest();
		ReportDefinition other = new ReportDefinition();
		other.setUuid("not-a-liberiaemr-report");
		// A third-party report in hand, with its own (non-ETL) data set. A bare reference to a
		// definition that cannot be found would be protected: the guard fails closed.
		SqlDataSetDefinition rows = new SqlDataSetDefinition();
		rows.setSqlQuery("SELECT 1");
		other.addDataSetDefinition("rows", Mapped.mapStraightThrough(rows));
		theirs.setReportDefinition(Mapped.noMappings(other));

		advice.before(load, new Object[] { ours }, null); // admin may

		Context.becomeUser("butch");
		advice.before(load, new Object[] { theirs }, null); // not ours: reporting's rules apply
		Object[] args = new Object[] { ours };
		assertThrows(APIAuthenticationException.class, () -> advice.before(load, args, null));
	}

	private ReportRequest request(User requestedBy) {
		ReportRequest request = new ReportRequest();
		request.setReportDefinition(Mapped.noMappings(registered(ReportSheet.EMR_OPS)));
		request.setRequestedBy(requestedBy);
		request.setStatus(ReportRequest.Status.COMPLETED);
		return Context.getService(ReportService.class).saveReportRequest(request);
	}
}
