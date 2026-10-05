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
import static org.junit.Assert.assertTrue;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.DISTRICT;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_ONE_OPD;
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_TWO;

import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;

/**
 * RMNCAH-017, 018, 019, 020, 021, 026 and 028 in Q3 2026. Children are under 5 at their
 * diagnoses unless noted; client 7 is client 1's record at facility two (one person).
 */
public class RmncahReportManagerTest extends IndicatorReportTestBase {

	private static final String DX = "mamba_fact_malaria_diagnosis (diagnosis_id, encounter_id, visit_id, client_id,"
	        + " encounter_datetime, location_id, facility_location_id, icd10_category, icd10_group)";

	private static final String DRUG = "mamba_fact_malaria_drug (order_id, visit_id, client_id, location_id,"
	        + " facility_location_id, is_pneumonia_antibiotic, is_oral_rehydration)";

	@Before
	public void loadFacts() throws Exception {
		person(1, "2024-01-15", "F", "cpi:one");
		person(2, "2021-05-10", "M"); // 62 months in July 2026
		person(3, "2025-06-15", "M");
		person(5, "2024-03-15", "F");
		person(6, "2023-02-10", "M");
		person(7, "2024-01-15", "F", "cpi:one");

		// diarrhoea
		etl(DX, "(1, 1, 11, 1, '2026-06-25 10:00:00', " + F1_OPD + ", " + F1 + ", 'A09', 'diarrhoea')", // before Q3
		    "(2, 2, 12, 1, '2026-07-20 10:00:00', " + F1_OPD + ", " + F1 + ", 'A09', 'diarrhoea')", // 25 days later: new
		    "(3, 3, 13, 3, '2026-08-05 10:00:00', " + F1 + ", " + F1 + ", 'A09', 'diarrhoea')",
		    "(4, 4, 15, 3, '2026-08-12 10:00:00', " + F1 + ", " + F1 + ", 'A09', 'diarrhoea')", // day 7: same episode
		    "(5, 5, 16, 2, '2026-08-01 10:00:00', " + F1 + ", " + F1 + ", 'A09', 'diarrhoea')", // over 5
		    "(6, 6, 17, 6, '2026-06-28 10:00:00', " + F1 + ", " + F1 + ", 'A09', 'diarrhoea')",
		    "(7, 7, 18, 6, '2026-07-05 10:00:00', " + F1 + ", " + F1 + ", 'A09', 'diarrhoea')", // continues 28 Jun
		    "(8, 8, 51, 5, '2026-07-25 10:00:00', " + F2 + ", " + F2 + ", 'A09', 'diarrhoea')",
		    "(9, 9, 71, 7, '2026-07-25 11:00:00', " + F2 + ", " + F2 + ", 'A09', 'diarrhoea')");
		etl(DRUG, "(1, 12, 1, " + F1_OPD + ", " + F1 + ", 0, 1)", // ORS in the diagnosis visit
		    "(2, 14, 3, " + F1 + ", " + F1 + ", 0, 1)", // ORS in a later visit
		    "(3, 51, 5, " + F2 + ", " + F2 + ", 0, 1)");

		// pneumonia
		etl(DX, "(20, 20, 21, 1, '2026-08-01 10:00:00', " + F1_OPD + ", " + F1 + ", 'J18', 'pneumonia')",
		    "(21, 21, 23, 3, '2026-08-20 10:00:00', " + F1 + ", " + F1 + ", 'J18', 'pneumonia')",
		    "(22, 22, 24, 3, '2026-09-10 10:00:00', " + F1 + ", " + F1 + ", 'J15', 'pneumonia')", // day 21: new
		    "(23, 23, 25, 2, '2026-09-10 10:00:00', " + F1 + ", " + F1 + ", 'J18', 'pneumonia')"); // over 5
		etl(DRUG, "(20, 21, 1, " + F1_OPD + ", " + F1 + ", 1, 0)", // antibiotic in the visit
		    "(21, 24, 3, " + F1 + ", " + F1 + ", 0, 1)", // ORS is not an antibiotic
		    "(22, 25, 2, " + F1 + ", " + F1 + ", 1, 0)");

		// family planning, current users at 30 Sep
		person(40, "1990-01-01", "F");
		person(41, "1980-05-05", "F");
		person(42, "1976-09-15", "F"); // 50 on 30 Sep
		person(43, "1995-02-02", "F");
		person(44, "1998-03-03", "F");
		person(45, "1992-04-04", "F");
		String fp = "mamba_fact_rmncah_family_planning (encounter_id, client_id, person_key, birthdate, gender,"
		        + " encounter_datetime, location_id, facility_location_id, is_modern_method, protected_until,"
		        + " method_removed_date)";
		etl(fp, "(40, 40, 'patient:40', '1990-01-01', 'F', '2026-08-15 09:00:00', " + F1_OPD + ", " + F1
		        + ", 1, '2026-11-15', NULL)",
		    "(41, 41, 'patient:41', '1980-05-05', 'F', '2026-01-10 09:00:00', " + F1 + ", " + F1
		            + ", 1, '2029-01-10', NULL)",
		    "(141, 41, 'patient:41', '1980-05-05', 'F', '2026-09-01 09:00:00', " + F1 + ", " + F1
		            + ", 0, NULL, '2026-09-01')", // latest records removal
		    "(42, 42, 'patient:42', '1976-09-15', 'F', '2026-02-01 09:00:00', " + F1 + ", " + F1
		            + ", 1, '2036-02-01', NULL)",
		    "(43, 43, 'patient:43', '1995-02-02', 'F', '2026-05-01 09:00:00', " + F1 + ", " + F1
		            + ", 1, '2026-08-01', NULL)", // expired
		    "(44, 44, 'patient:44', '1998-03-03', 'F', '2026-09-20 09:00:00', " + F2 + ", " + F2
		            + ", 1, '2026-10-20', NULL)",
		    "(45, 45, 'patient:45', '1992-04-04', 'F', '2026-07-01 09:00:00', " + F1 + ", " + F1
		            + ", 1, '2026-10-01', NULL)",
		    "(145, 45, 'patient:45', '1992-04-04', 'F', '2026-10-05 09:00:00', " + F1 + ", " + F1
		            + ", 0, NULL, '2026-10-05')"); // after the period end: not her latest yet

		// deliveries
		String delivery = "mamba_fact_rmncah_delivery (encounter_id, client_id, person_key, location_id,"
		        + " facility_location_id, is_episode_start, episode_start_datetime, episode_delivery_method)";
		etl(delivery, "(50, 50, 'patient:50', " + F1 + ", " + F1 + ", 1, '2026-07-05 03:00:00', 'caesarean')",
		    "(150, 50, 'patient:50', " + F1 + ", " + F1 + ", 0, '2026-07-05 03:00:00', 'caesarean')",
		    "(51, 51, 'patient:51', " + F1_OPD + ", " + F1 + ", 1, '2026-08-10 03:00:00', 'svd')",
		    "(52, 52, 'patient:52', " + F1 + ", " + F1 + ", 1, '2026-09-12 03:00:00', NULL)",
		    "(53, 53, 'patient:53', " + F2 + ", " + F2 + ", 1, '2026-07-15 03:00:00', 'svd')",
		    "(54, 54, 'patient:54', " + F1 + ", " + F1 + ", 1, '2026-06-29 03:00:00', 'caesarean')");

		// Mother PNC
		String pnc = "mamba_fact_rmncah_mother_pnc (encounter_id, client_id, person_key, location_id,"
		        + " facility_location_id, is_episode_start, episode_start_datetime, episode_place_of_delivery)";
		etl(pnc, "(60, 60, 'patient:60', " + F1 + ", " + F1 + ", 1, '2026-07-10 09:00:00', 'home')",
		    "(160, 60, 'patient:60', " + F1 + ", " + F1 + ", 0, '2026-07-10 09:00:00', 'home')",
		    "(61, 61, 'patient:61', " + F1 + ", " + F1 + ", 1, '2026-08-10 09:00:00', 'health_facility')",
		    "(62, 62, 'patient:62', " + F2 + ", " + F2 + ", 1, '2026-08-11 09:00:00', 'home')");
	}

	@Test
	public void facility_shouldCountItsOwnEvents() throws Exception {
		Map<String, Object> row = q3(ReportSheet.RMNCAH, null);
		assertCount(row, "RMNCAH_017_NUM", 2); // 40, 45
		assertRatio(row, "RMNCAH_018", 1, 3, 33.3); // 1, 3, 6; treated 1
		assertCount(row, "RMNCAH_019_NUM", 2); // 20 Jul (client 1), 5 Aug (client 3)
		assertCount(row, "RMNCAH_020_NUM", 3); // 1 Aug, 20 Aug, 10 Sep
		assertRatio(row, "RMNCAH_021", 1, 2, 50.0);
		assertRatio(row, "RMNCAH_026", 1, 2, 50.0);
		assertCount(row, "RMNCAH_028_NUM", 1);
	}

	@Test
	public void numeratorOnlyRows_shouldHaveNoDenominatorOrValue() throws Exception {
		Map<String, Object> row = q3(ReportSheet.RMNCAH, null);
		for (String code : new String[] { "RMNCAH_017", "RMNCAH_019", "RMNCAH_020", "RMNCAH_028" }) {
			assertTrue(row.containsKey(code + "_NUM"));
			assertFalse(code, row.containsKey(code + "_DEN"));
			assertFalse(code, row.containsKey(code + "_PCT"));
		}
	}

	@Test
	public void facility_shouldCountADepartmentsEventsOnlyForIt() throws Exception {
		Map<String, Object> row = q3(ReportSheet.RMNCAH, FACILITY_ONE_OPD);
		assertCount(row, "RMNCAH_017_NUM", 1);
		assertRatio(row, "RMNCAH_018", 1, 1, 100.0);
		assertRatio(row, "RMNCAH_026", 0, 1, 0.0);
	}

	@Test
	public void central_shouldRollUpAndCountEachPersonOnce() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> f2 = q3(ReportSheet.RMNCAH, FACILITY_TWO);
		assertCount(f2, "RMNCAH_017_NUM", 1);
		assertRatio(f2, "RMNCAH_018", 1, 2, 50.0);
		assertCount(f2, "RMNCAH_019_NUM", 2); // new at facility two
		assertRatio(f2, "RMNCAH_026", 0, 1, 0.0);
		assertCount(f2, "RMNCAH_028_NUM", 1);

		for (String scope : new String[] { null, DISTRICT }) {
			Map<String, Object> all = q3(ReportSheet.RMNCAH, scope);
			assertCount(all, "RMNCAH_017_NUM", 3);
			// person "one" is one child, treated at facility one
			assertRatio(all, "RMNCAH_018", 2, 4, 50.0);
			// person "one"'s facility-two diagnosis is day 5 of the facility-one episode
			assertCount(all, "RMNCAH_019_NUM", 3);
			assertRatio(all, "RMNCAH_026", 1, 3, 33.3);
			assertCount(all, "RMNCAH_028_NUM", 2);
		}
	}

	@Test
	public void central_shouldReturnNoValueWhenTheDenominatorIsZero() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> row = indicators(ReportSheet.RMNCAH, "2025-01-01", "2025-03-31", null);
		assertRatio(row, "RMNCAH_018", 0, 0, null);
		assertCount(row, "RMNCAH_019_NUM", 0);
	}

	@Test
	public void central_shouldEqualTheFacilityForThatFacility() throws Exception {
		assertFacilityEqualsCentralForIt(ReportSheet.RMNCAH, Q3_START, Q3_END);
	}

	@Test
	public void central_byFacilityShouldEqualEachFacilitysOwnRun() throws Exception {
		assertByFacilityMatchesFacilityRuns(ReportSheet.RMNCAH, Q3_START, Q3_END);
	}
}
