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
 * NCD-002, 005, 007, 011 and 015 in Q3 2026. Keys {@code cpi:ca} and {@code cpi:bp} are people with
 * a record at each facility.
 */
public class NcdReportManagerTest extends IndicatorReportTestBase {

	private static final String DX = "mamba_fact_malaria_diagnosis (diagnosis_id, encounter_id, visit_id, client_id,"
	        + " encounter_datetime, location_id, facility_location_id, icd10_category, icd10_group)";

	private static final String LAB = "mamba_fact_malaria_lab_result (order_id, result_obs_id, client_id, location_id,"
	        + " facility_location_id, resulted_at, test_code, test_group, value_numeric, is_malaria_positive)";

	@Before
	public void loadFacts() throws Exception {
		// NCD-002
		String death = "mamba_fact_ncd_death (client_id, death_date, age_years_at_death, cause_group, location_id,"
		        + " facility_location_id)";
		etl(death, "(120, '2026-07-10 00:00:00', 30, 'cancer', " + F1 + ", " + F1 + ")",
		    "(121, '2026-07-10 00:00:00', 70, 'cancer', " + F1 + ", " + F1 + ")",
		    "(122, '2026-07-10 00:00:00', 50, 'infectious', " + F1 + ", " + F1 + ")",
		    "(123, '2026-09-30 00:00:00', 69, 'cancer', " + F2 + ", " + F2 + ")",
		    "(124, '2026-06-30 00:00:00', 45, 'cancer', " + F1 + ", " + F1 + ")",
		    "(125, '2026-07-10 00:00:00', 45, 'cancer', NULL, NULL)"); // no visit: not attributable
		person(120, "1996-07-10", "F");
		person(121, "1956-01-01", "M");
		person(122, "1976-01-01", "M");
		person(123, "1957-01-01", "M");
		person(124, "1981-01-01", "F");
		person(125, "1981-01-01", "F");

		// NCD-005
		etl(DX, "(1, 1, 1, 130, '2026-07-05 09:00:00', " + F1 + ", " + F1 + ", 'C50', 'cancer')",
		    "(2, 2, 2, 130, '2026-08-05 09:00:00', " + F1 + ", " + F1 + ", 'C50', 'cancer')", // repeat
		    "(3, 3, 3, 130, '2026-08-06 09:00:00', " + F1 + ", " + F1 + ", 'C53', 'cancer')", // another site
		    "(4, 4, 4, 131, '2026-03-01 09:00:00', " + F1 + ", " + F1 + ", 'C61', 'cancer')",
		    "(5, 5, 5, 131, '2026-07-15 09:00:00', " + F1 + ", " + F1 + ", 'C61', 'cancer')", // repeat
		    "(6, 6, 6, 132, '2026-02-01 09:00:00', " + F2 + ", " + F2 + ", 'C53', 'cancer')",
		    "(7, 7, 7, 133, '2026-07-20 09:00:00', " + F1_OPD + ", " + F1 + ", 'C53', 'cancer')", // new to F1
		    "(8, 8, 8, 134, '2026-09-01 09:00:00', " + F2 + ", " + F2 + ", 'C61', 'cancer')");
		person(130, "1970-01-01", "F");
		person(131, "1950-01-01", "M");
		person(132, "1975-01-01", "F", "cpi:ca");
		person(133, "1975-01-01", "F", "cpi:ca");
		person(134, "1955-01-01", "M");

		// NCD-007
		String bp = "mamba_fact_ncd_blood_pressure (encounter_id, client_id, encounter_datetime, location_id,"
		        + " facility_location_id, is_raised)";
		etl(bp, "(1, 140, '2026-07-05 09:00:00', " + F1 + ", " + F1 + ", 1)",
		    "(2, 140, '2026-08-05 09:00:00', " + F1 + ", " + F1 + ", 0)", // latest
		    "(3, 141, '2026-07-05 09:00:00', " + F1_OPD + ", " + F1 + ", 1)",
		    "(4, 142, '2026-07-05 09:00:00', " + F1 + ", " + F1 + ", 1)", // 16
		    "(5, 143, '2026-07-20 09:00:00', " + F1 + ", " + F1 + ", 1)", // 18 since 15 Jul
		    "(6, 144, '2026-07-05 09:00:00', " + F2 + ", " + F2 + ", 1)",
		    "(7, 145, '2026-07-01 09:00:00', " + F1 + ", " + F1 + ", 1)",
		    "(8, 146, '2026-08-01 09:00:00', " + F2 + ", " + F2 + ", 0)"); // the person's latest
		person(140, "1980-01-01", "M");
		person(141, "1990-01-01", "F");
		person(142, "2010-01-01", "M");
		person(143, "2008-07-15", "F");
		person(144, "1970-01-01", "M");
		person(145, "1960-01-01", "F", "cpi:bp");
		person(146, "1960-01-01", "F", "cpi:bp");

		// NCD-011
		String chol = ", 'cholesterol_total', 'lipid', ";
		etl(LAB, "(50, 501, 150, " + F1 + ", " + F1 + ", '2026-07-05 09:00:00'" + chol + "6.2, 0)",
		    "(51, 511, 150, " + F1 + ", " + F1 + ", '2026-08-05 09:00:00'" + chol + "4.5, 0)", // latest
		    "(52, 521, 151, " + F1 + ", " + F1 + ", '2026-07-05 09:00:00'" + chol + "5.0, 0)",
		    "(53, 531, 152, " + F1 + ", " + F1 + ", '2026-07-05 09:00:00'" + chol + "7.0, 0)", // 14
		    "(54, 541, 153, " + F2 + ", " + F2 + ", '2026-07-05 09:00:00'" + chol + "5.8, 0)",
		    "(55, 0, 154, " + F1 + ", " + F1 + ", NULL" + chol + "NULL, 0)"); // ordered, no result
		person(150, "1980-01-01", "M");
		person(151, "1985-01-01", "F");
		person(152, "2012-01-01", "M");
		person(153, "1975-01-01", "F");
		person(154, "1975-01-01", "F");

		// NCD-015
		etl(DX, "(60, 60, 60, 160, '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 'N19', 'renal')",
		    "(62, 62, 62, 162, '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 'N03', 'renal')", // untested
		    "(63, 63, 63, 163, '2026-07-10 09:00:00', " + F1 + ", " + F1 + ", 'N19', 'renal')", // 16
		    "(65, 65, 65, 165, '2026-07-10 09:00:00', " + F2 + ", " + F2 + ", 'N18', 'renal')");
		etl(LAB, "(60, 601, 160, " + F1 + ", " + F1 + ", '2026-07-10 09:00:00', 'creatinine_umol', 'renal', 90, 0)",
		    "(61, 611, 161, " + F1 + ", " + F1 + ", '2026-07-10 09:00:00', 'urea', 'renal', 5, 0)",
		    "(63, 631, 163, " + F1 + ", " + F1 + ", '2026-07-10 09:00:00', 'egfr', 'renal', 50, 0)",
		    "(64, 0, 164, " + F1 + ", " + F1 + ", NULL, 'urea', 'renal', NULL, 0)"); // no result
		person(160, "1970-01-01", "M");
		person(161, "1980-01-01", "F");
		person(162, "1975-01-01", "M");
		person(163, "2010-01-01", "F");
		person(164, "1985-01-01", "M");
		person(165, "1960-01-01", "F");
	}

	@Test
	public void facility_shouldCountItsOwnPeople() throws Exception {
		Map<String, Object> row = q3(ReportSheet.NCD, null);
		assertCount(row, "NCD_002_NUM", 1); // 120, on the 30th birthday
		assertCount(row, "NCD_005_NUM", 3); // 130 breast and cervical, cpi:ca cervical
		assertCount(row, "NCD_005_NUM_BREAST", 1);
		assertCount(row, "NCD_005_NUM_CERVICAL", 2);
		assertCount(row, "NCD_005_NUM_PROSTATE", 0);
		assertRatio(row, "NCD_007", 3, 4, 75.0); // den 140, 141, 143, cpi:bp
		assertRatio(row, "NCD_011", 1, 2, 50.0); // den 150 (latest 4.5), 151 (5.0)
		assertRatio(row, "NCD_015", 2, 2, 100.0); // num 160, 162; den 160, 161
		assertFalse(row.containsKey("NCD_002_DEN"));
		assertFalse(row.containsKey("NCD_005_DEN"));
	}

	@Test
	public void central_shouldRollUpAndJudgeWithinTheScope() throws Exception {
		asRole(InstanceRole.CENTRAL);
		Map<String, Object> f2 = q3(ReportSheet.NCD, FACILITY_TWO);
		assertCount(f2, "NCD_002_NUM", 1);
		assertCount(f2, "NCD_005_NUM", 1);
		assertCount(f2, "NCD_005_NUM_PROSTATE", 1);
		assertRatio(f2, "NCD_007", 1, 2, 50.0); // cpi:bp's latest reading anywhere is not raised
		assertRatio(f2, "NCD_011", 1, 1, 100.0);
		assertRatio(f2, "NCD_015", 1, 0, null);

		Map<String, Object> national = q3(ReportSheet.NCD, null);
		assertCount(national, "NCD_002_NUM", 2); // not 125, which no location claims
		// cpi:ca's cervical cancer was first diagnosed at facility two, before Q3
		assertCount(national, "NCD_005_NUM", 3);
		assertCount(national, "NCD_005_NUM_CERVICAL", 1);
		assertRatio(national, "NCD_007", 3, 5, 60.0);
		assertRatio(national, "NCD_011", 2, 3, 66.7);
		assertRatio(national, "NCD_015", 3, 2, 150.0);
	}

	@Test
	public void central_shouldEqualTheFacilityForThatFacility() throws Exception {
		assertFacilityEqualsCentralForIt(ReportSheet.NCD, Q3_START, Q3_END);
	}

	@Test
	public void central_byFacilityShouldEqualEachFacilitysOwnRun() throws Exception {
		assertByFacilityMatchesFacilityRuns(ReportSheet.NCD, Q3_START, Q3_END);
	}
}
