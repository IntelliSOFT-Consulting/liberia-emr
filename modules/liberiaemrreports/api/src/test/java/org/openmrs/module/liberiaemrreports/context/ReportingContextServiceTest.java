/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.context;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.GlobalProperty;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.EtlTestSupport;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

public class ReportingContextServiceTest extends BaseModuleContextSensitiveTest {
	
	private static final String FACILITY_ONE = "c2a1f754-1594-491a-aff2-6d446c09900f";
	
	@Autowired
	private LocationScopeResolver locationScopeResolver;
	
	@Autowired
	private ReportingContextService service;
	
	@Before
	public void setUp() throws Exception {
		EtlTestSupport.createEtlTables(getConnection());
		executeDataSet("LiberiaEMRReportsTestDataset.xml");
		Context.getAdministrationService()
		        .saveGlobalProperty(new GlobalProperty(LocationScopeResolver.GP_FACILITY_LOCATION, FACILITY_ONE));
	}
	
	@After
	public void tearDown() {
		locationScopeResolver.setRoleOverride(null);
	}
	
	@Test
	public void facility_shouldNameItsOwnLocation() {
		locationScopeResolver.setRoleOverride(InstanceRole.FACILITY);
		Map<String, Object> context = service.getContext();
		assertEquals("facility", context.get("instanceRole"));
		@SuppressWarnings("unchecked")
		Map<String, Object> facility = (Map<String, Object>) context.get("facilityLocation");
		assertEquals(FACILITY_ONE, facility.get("uuid"));
		assertEquals("Test Facility One", facility.get("display"));
		assertEquals(EtlTestSupport.SCHEMA, context.get("etlSchema"));
	}
	
	@Test
	public void central_shouldHaveNoFacilityLocation() {
		locationScopeResolver.setRoleOverride(InstanceRole.CENTRAL);
		Map<String, Object> context = service.getContext();
		assertEquals("central", context.get("instanceRole"));
		assertNull(context.get("facilityLocation"));
	}
	
	@Test
	public void etlLastRun_shouldBeEmptyBeforeTheFirstRun() {
		assertTrue(service.getEtlLastRun().isEmpty());
	}
	
	@Test
	public void etlLastRun_shouldReportTheLatestRun() throws Exception {
		EtlTestSupport.execute(getConnection(),
		    "INSERT INTO " + EtlTestSupport.SCHEMA + "._mamba_etl_schedule"
		            + " (start_time, end_time, completion_status, transaction_status) VALUES"
		            + " ('2026-09-27 01:00:00', '2026-09-27 01:04:00', 'SUCCESS', 'COMPLETED')");
		Map<String, Object> run = service.getEtlLastRun();
		assertNotNull(run);
		assertEquals("SUCCESS", run.get("status"));
		assertNotNull(run.get("startedAt"));
		assertNotNull(run.get("completedAt"));
		
		EtlTestSupport.execute(getConnection(), "INSERT INTO " + EtlTestSupport.SCHEMA + "._mamba_etl_schedule"
		        + " (start_time, transaction_status) VALUES ('2026-09-27 02:00:00', 'RUNNING')");
		run = service.getEtlLastRun();
		assertEquals("RUNNING", run.get("status"));
		assertNull(run.get("completedAt"));
	}
	
	@Test
	public void status_shouldReadCoreThreeZeroZerosMarkers() {
		assertEquals("SUCCESS", ReportingContextService.status("COMPLETED", "SUCCESS", null));
		assertEquals("RUNNING", ReportingContextService.status("RUNNING", null, null));
		assertEquals("INTERRUPTED",
		    ReportingContextService.status("COMPLETED", "SUCCESS", ReportingContextService.STUCK_MESSAGE));
		assertEquals("ERROR", ReportingContextService.status("COMPLETED", "SUCCESS", ReportingContextService.ERROR_MESSAGE));
		assertEquals("ERROR", ReportingContextService.status("COMPLETED", "ERROR", null));
		assertEquals("ERROR", ReportingContextService.status("COMPLETED", "SUCCESS", "some other message"));
	}
}
