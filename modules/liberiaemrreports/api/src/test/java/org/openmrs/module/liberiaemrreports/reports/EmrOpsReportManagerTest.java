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

import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_ONE;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_ONE_OPD;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_TWO;

import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;

/**
 * EMR-OPS-007, 008 and 015 in Q3 2026. EMR-OPS-008 counts the encounters of
 * LiberiaEMRReportsTestDataset.xml (9002 was entered a day late) plus a system-type one. The
 * identity flags are the ETL's; {@code cpi:c} is one person with a record at each facility and
 * {@code cpi:d} two records of one person at facility two.
 */
public class EmrOpsReportManagerTest extends IndicatorReportTestBase {

	@Before
	public void loadFacts() throws Exception {
		// a system-type encounter (an Order) in the period: never counted
		etl("mamba_dim_encounter (encounter_id, encounter_type, encounter_datetime, date_created, voided)",
		    "(9008, 2, '2026-07-10 11:00:00', '2026-07-10 11:00:00', FALSE)");
		etl("mamba_dim_encounter_location (encounter_id, visit_id, encounter_location_id, visit_location_id, location_id)",
		    "(9008, NULL, 103, NULL, 103)");

		String patient = "mamba_fact_emr_ops_patient (client_id, person_key, date_registered, location_id,"
		        + " facility_location_id, hrn_consistent, is_probable_duplicate, same_facility_link,"
		        + " person_national_id_consistent)";
		etl(patient, "(200, 'cpi:a', '2026-01-01 08:00:00', " + F1 + ", " + F1 + ", 1, 1, 0, 1)",
		    "(201, 'cpi:b', '2026-01-01 08:00:00', " + F1 + ", " + F1 + ", 0, 1, 0, 0)",
		    "(202, 'cpi:c', '2026-01-01 08:00:00', " + F1 + ", " + F1 + ", 1, 0, 0, 1)",
		    "(203, 'cpi:e', '2026-10-10 08:00:00', " + F1 + ", " + F1 + ", 1, 0, 0, 0)", // registered later
		    "(204, 'cpi:c', '2026-01-01 08:00:00', " + F2 + ", " + F2 + ", 1, 0, 0, 1)",
		    "(205, 'cpi:d', '2026-01-01 08:00:00', " + F2 + ", " + F2 + ", 1, 0, 1, 0)",
		    "(206, 'cpi:d', '2026-01-01 08:00:00', " + F2 + ", " + F2 + ", 1, 0, 1, 0)");
		for (int client : new int[] { 200, 201, 202, 203, 204, 205, 206 }) {
			String key = client == 200 ? "cpi:a" : client == 201 ? "cpi:b" : client == 205 || client == 206 ? "cpi:d"
			        : client == 203 ? "cpi:e" : "cpi:c";
			person(client, "1990-01-01", "F", key);
		}

		String visit = "mamba_fact_emr_ops_visit (visit_id, client_id, date_started, location_id, facility_location_id)";
		etl(visit, "(1, 200, '2026-06-30 09:00:00', " + F1 + ", " + F1 + ")", // before Q3
		    "(2, 200, '2026-07-02 09:00:00', " + F1 + ", " + F1 + ")",
		    "(3, 200, '2026-08-02 09:00:00', " + F1_OPD + ", " + F1 + ")",
		    "(4, 201, '2026-07-03 09:00:00', " + F1 + ", " + F1 + ")",
		    "(5, 201, '2026-07-04 09:00:00', " + F1 + ", " + F1 + ")",
		    "(6, 202, '2026-07-05 09:00:00', " + F1 + ", " + F1 + ")",
		    "(7, 204, '2026-07-06 09:00:00', " + F2 + ", " + F2 + ")",
		    "(8, 205, '2026-07-07 09:00:00', " + F2 + ", " + F2 + ")",
		    "(9, 206, '2026-07-08 09:00:00', " + F2 + ", " + F2 + ")");
	}

	@Test
	public void facility_shouldUseTheFacilityDefinitions() throws Exception {
		Map<String, Object> row = q3(ReportSheet.EMR_OPS, null);
		assertRatio(row, "EMR_OPS_007", 2, 3, 66.7); // 200 and 201 of 200-202
		assertRatio(row, "EMR_OPS_008", 3, 4, 75.0); // 9002 late; not the Order
		assertRatio(row, "EMR_OPS_015", 1, 2, 50.0); // 200 and 201 have 2 visits; 200's HRN is consistent

		assertRatio(q3(ReportSheet.EMR_OPS, FACILITY_ONE_OPD), "EMR_OPS_008", 1, 2, 50.0);
	}

	@Test
	public void central_shouldUseTheCentralDefinitions() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> f1 = q3(ReportSheet.EMR_OPS, FACILITY_ONE);
		assertRatio(f1, "EMR_OPS_007", 0, 3, 0.0); // persons a, b, c
		assertRatio(f1, "EMR_OPS_008", 3, 4, 75.0);
		assertRatio(f1, "EMR_OPS_015", 1, 2, 50.0); // a and b; a's National ID is consistent

		Map<String, Object> f2 = q3(ReportSheet.EMR_OPS, FACILITY_TWO);
		assertRatio(f2, "EMR_OPS_007", 1, 2, 50.0); // d linked twice at facility two; persons c, d
		assertRatio(f2, "EMR_OPS_008", 1, 1, 100.0);
		assertRatio(f2, "EMR_OPS_015", 0, 1, 0.0); // d, 2 visits across 2 records

		Map<String, Object> national = q3(ReportSheet.EMR_OPS, null);
		assertRatio(national, "EMR_OPS_007", 1, 4, 25.0);
		assertRatio(national, "EMR_OPS_008", 4, 5, 80.0);
		assertRatio(national, "EMR_OPS_015", 2, 4, 50.0); // c has a visit at each facility
	}

	@Test
	public void central_shouldEqualTheFacilityForEmrOps008() throws Exception {
		assertFacilityEqualsCentralForIt(ReportSheet.EMR_OPS, Q3_START, Q3_END, "EMR_OPS_008_NUM", "EMR_OPS_008_DEN",
		    "EMR_OPS_008_PCT");
	}

	@Test
	public void central_byFacilityShouldEqualEachFacilitysOwnRun() throws Exception {
		assertByFacilityMatchesFacilityRuns(ReportSheet.EMR_OPS, Q3_START, Q3_END);
	}
}
