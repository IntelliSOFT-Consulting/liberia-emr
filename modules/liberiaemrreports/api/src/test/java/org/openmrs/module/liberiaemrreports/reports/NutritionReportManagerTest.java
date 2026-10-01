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
import static org.openmrs.module.liberiaemrreports.EtlTestSupport.FACILITY_TWO;

import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;

/**
 * NUT-005, NUT-008 and NUT-009 in Q3 2026. The ETL facts carry the child's age in months and person
 * key; key {@code cpi:va} is one child with a record at each facility.
 */
public class NutritionReportManagerTest extends IndicatorReportTestBase {

	@Before
	public void loadFacts() throws Exception {
		String vitaminA = "mamba_fact_nutrition_vitamin_a (event_id, client_id, person_key, event_datetime, location_id,"
		        + " facility_location_id, dose_iu, age_months)";
		etl(vitaminA, "(1, 70, 'patient:70', '2026-07-10 09:00:00', " + F1_OPD + ", " + F1 + ", 100000, 6)",
		    "(2, 70, 'patient:70', '2026-08-10 09:00:00', " + F1 + ", " + F1 + ", 100000, 7)", // once per child
		    "(3, 71, 'patient:71', '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 100000, 5)",
		    "(4, 72, 'patient:72', '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 100000, 12)",
		    "(5, 73, 'patient:73', '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 200000, 8)", // Red, not Blue
		    "(6, 74, 'patient:74', '2026-07-10 09:00:00', " + F2 + ", " + F2 + ", 100000, 11)",
		    "(7, 76, 'cpi:va', '2026-07-10 09:00:00', " + F2 + ", " + F2 + ", 100000, 9)",
		    "(8, 77, 'cpi:va', '2026-08-10 09:00:00', " + F1 + ", " + F1 + ", 100000, 10)",
		    "(9, 78, 'patient:78', '2026-06-30 23:59:59', " + F1 + ", " + F1 + ", 100000, 8)"); // before Q3

		String anthropometry = "mamba_fact_nutrition_anthropometry (encounter_id, client_id, person_key,"
		        + " encounter_datetime, location_id, facility_location_id, age_months, muac_cm, whz)";
		etl(anthropometry, "(1, 80, 'patient:80', '2026-07-05 09:00:00', " + F1 + ", " + F1 + ", 24, 11.0, NULL)",
		    "(2, 80, 'patient:80', '2026-08-05 09:00:00', " + F1 + ", " + F1 + ", 25, 12.1, NULL)", // latest
		    "(3, 81, 'patient:81', '2026-07-15 09:00:00', " + F1_OPD + ", " + F1 + ", 30, 11.4, NULL)",
		    "(4, 81, 'patient:81', '2026-09-01 09:00:00', " + F1 + ", " + F1 + ", 31, NULL, -1.0)", // no MUAC
		    "(5, 82, 'patient:82', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 60, 10.0, NULL)",
		    "(6, 83, 'patient:83', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 4, 10.0, NULL)",
		    "(7, 84, 'patient:84', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 12, 11.5, NULL)",
		    "(8, 85, 'patient:85', '2026-07-15 09:00:00', " + F2 + ", " + F2 + ", 40, 11.2, NULL)",
		    "(9, 86, 'patient:86', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 30, NULL, -2.50)",
		    "(10, 87, 'patient:87', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 20, NULL, -3.00)",
		    "(11, 88, 'patient:88', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 20, NULL, -2.00)",
		    "(12, 89, 'patient:89', '2026-07-15 09:00:00', " + F2 + ", " + F2 + ", 50, NULL, -2.40)",
		    "(13, 90, 'patient:90', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 5, NULL, -2.50)",
		    "(14, 91, 'patient:91', '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 20, NULL, -3.90)");
	}

	@Test
	public void facility_shouldCountItsOwnChildren() throws Exception {
		Map<String, Object> row = q3(ReportSheet.NUTRITION, null);
		assertCount(row, "NUT_005_NUM", 2); // 70 once, cpi:va
		assertRatio(row, "NUT_008", 1, 3, 33.3); // 80 (latest 12.1), 81 (11.4), 84 (11.5)
		assertCount(row, "NUT_009_NUM", 2); // 86, 87 (exactly -3)
		assertFalse(row.containsKey("NUT_005_DEN"));
		assertFalse(row.containsKey("NUT_009_DEN"));
	}

	@Test
	public void central_shouldRollUpAndCountEachChildOnce() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> f2 = q3(ReportSheet.NUTRITION, FACILITY_TWO);
		assertCount(f2, "NUT_005_NUM", 2);
		assertRatio(f2, "NUT_008", 1, 1, 100.0);
		assertCount(f2, "NUT_009_NUM", 1);

		Map<String, Object> national = q3(ReportSheet.NUTRITION, null);
		assertCount(national, "NUT_005_NUM", 3);
		assertRatio(national, "NUT_008", 2, 4, 50.0);
		assertCount(national, "NUT_009_NUM", 3);
	}

	@Test
	public void central_shouldEqualTheFacilityForThatFacility() throws Exception {
		assertFacilityEqualsCentralForIt(ReportSheet.NUTRITION, Q3_START, Q3_END);
	}

	@Test
	public void central_byFacilityShouldEqualEachFacilitysOwnRun() throws Exception {
		assertByFacilityMatchesFacilityRuns(ReportSheet.NUTRITION, Q3_START, Q3_END);
	}
}
