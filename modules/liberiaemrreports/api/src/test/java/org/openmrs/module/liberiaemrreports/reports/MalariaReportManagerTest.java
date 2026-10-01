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

import static org.junit.Assert.assertFalse;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.COUNTY;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_TWO;

import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;

/**
 * MAL-002, MAL-003 and MAL-004 in Q3 2026. Keys {@code cpi:anc} and {@code cpi:mal} are one woman
 * and one patient with a record at each facility.
 */
public class MalariaReportManagerTest extends IndicatorReportTestBase {

	@Before
	public void loadFacts() throws Exception {
		String anc = "mamba_fact_rmncah_anc_visit (encounter_id, client_id, person_key, encounter_datetime, location_id,"
		        + " facility_location_id, is_first_anc_contact, is_third_trimester, iptp_dose_number)";
		etl(anc, "(1, 100, 'patient:100', '2026-07-02 09:00:00', " + F1 + ", " + F1 + ", 1, 0, 1)",
		    "(2, 100, 'patient:100', '2026-09-01 09:00:00', " + F1 + ", " + F1 + ", 0, 1, 3)",
		    "(3, 101, 'patient:101', '2026-08-01 09:00:00', " + F1_OPD + ", " + F1 + ", 1, 1, NULL)",
		    "(4, 102, 'patient:102', '2026-08-15 09:00:00', " + F1 + ", " + F1 + ", 0, 0, 4)", // not a first contact
		    "(5, 103, 'patient:103', '2026-06-20 09:00:00', " + F1 + ", " + F1 + ", 1, 0, NULL)", // before Q3
		    "(6, 104, 'patient:104', '2026-07-20 09:00:00', " + F2 + ", " + F2 + ", 1, 1, 2)",
		    "(7, 105, 'cpi:anc', '2026-08-20 09:00:00', " + F2 + ", " + F2 + ", 0, 0, 3)",
		    "(8, 106, 'cpi:anc', '2026-07-20 09:00:00', " + F1 + ", " + F1 + ", 1, 0, 1)");

		String lab = "mamba_fact_malaria_lab_result (order_id, result_obs_id, client_id, location_id,"
		        + " facility_location_id, resulted_at, test_code, test_group, value_numeric, is_malaria_positive)";
		String rdt = ", 'malaria_rdt', 'malaria', NULL, ";
		etl(lab, "(1, 11, 110, " + F1 + ", " + F1 + ", '2026-07-10 09:00:00'" + rdt + "1)",
		    "(2, 21, 110, " + F1 + ", " + F1 + ", '2026-07-20 09:00:00'" + rdt + "1)", // day 10: same episode
		    "(3, 31, 111, " + F1 + ", " + F1 + ", '2026-06-20 09:00:00'" + rdt + "1)",
		    "(4, 41, 111, " + F1 + ", " + F1 + ", '2026-07-15 09:00:00'" + rdt + "1)", // day 25 of June's episode
		    "(5, 51, 112, " + F1 + ", " + F1 + ", '2026-08-01 09:00:00'" + rdt + "0)", // negative
		    "(6, 61, 113, " + F1_OPD + ", " + F1 + ", '2026-08-01 09:00:00'" + rdt + "1)",
		    "(7, 71, 113, " + F1 + ", " + F1 + ", '2026-09-01 09:00:00'" + rdt + "1)", // day 31: new
		    "(8, 81, 114, " + F1 + ", " + F1 + ", '2026-08-01 09:00:00'" + rdt + "1)",
		    "(8, 82, 114, " + F1 + ", " + F1 + ", '2026-08-01 09:00:00'" + rdt + "1)", // same order, same time
		    "(9, 91, 115, " + F2 + ", " + F2 + ", '2026-07-12 09:00:00'" + rdt + "1)",
		    "(10, 101, 116, " + F1 + ", " + F1 + ", '2026-07-18 09:00:00'" + rdt + "1)", // day 6 of 115's
		    "(11, 0, 117, " + F1 + ", " + F1 + ", '2026-07-18 09:00:00'" + rdt + "0)"); // no result yet
		person(110, "1990-01-01", "M");
		person(111, "1990-01-01", "M");
		person(112, "1990-01-01", "M");
		person(113, "1990-01-01", "M");
		person(114, "1990-01-01", "M");
		person(115, "1990-01-01", "F", "cpi:mal");
		person(116, "1990-01-01", "F", "cpi:mal");
		person(117, "1990-01-01", "F");
	}

	@Test
	public void facility_shouldCountItsOwnWomenAndCases() throws Exception {
		Map<String, Object> row = q3(ReportSheet.MALARIA, null);
		assertRatio(row, "MAL_002", 2, 3, 66.7); // num 100, 102; den 100, 101, cpi:anc
		assertRatio(row, "MAL_003", 1, 2, 50.0); // den 100, 101; num 100
		assertCount(row, "MAL_004_NUM", 5); // 110, 113 twice, 114 once, 116
		assertFalse(row.containsKey("MAL_004_DEN"));
	}

	@Test
	public void central_shouldRollUpAndCountEachPersonOnce() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> f2 = q3(ReportSheet.MALARIA, FACILITY_TWO);
		assertRatio(f2, "MAL_002", 1, 1, 100.0);
		assertRatio(f2, "MAL_003", 1, 1, 100.0);
		assertCount(f2, "MAL_004_NUM", 1);

		Map<String, Object> county = q3(ReportSheet.MALARIA, COUNTY);
		assertRatio(county, "MAL_002", 3, 4, 75.0);
		assertRatio(county, "MAL_003", 2, 3, 66.7);
		// 116's result is day 6 of the same person's episode at facility two
		assertCount(county, "MAL_004_NUM", 5);
	}

	@Test
	public void central_shouldEqualTheFacilityForThatFacility() throws Exception {
		assertFacilityEqualsCentralForIt(ReportSheet.MALARIA, Q3_START, Q3_END);
	}

	@Test
	public void central_byFacilityShouldEqualEachFacilitysOwnRun() throws Exception {
		assertByFacilityMatchesFacilityRuns(ReportSheet.MALARIA, Q3_START, Q3_END);
	}
}
