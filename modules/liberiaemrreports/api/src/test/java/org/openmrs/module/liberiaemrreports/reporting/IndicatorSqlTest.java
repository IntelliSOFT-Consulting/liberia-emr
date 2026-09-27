/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reporting;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

public class IndicatorSqlTest {
	
	@Test
	public void column_shouldFollowTheReadmeNaming() {
		assertEquals("MAL_004_NUM", IndicatorSql.column("MAL-004", "num"));
		assertEquals("EMR_OPS_007_DEN", IndicatorSql.column("EMR-OPS-007", "DEN"));
	}
	
	@Test
	public void disaggregated_shouldProduceTheTotalEachOptionAndEachCombination() {
		List<String> columns = IndicatorSql.disaggregated("MAL_004_NUM", null, "f.positive = 1",
		    Disaggregation.sex("f.gender"),
		    Disaggregation.standardAgeBands(Disaggregation.ageInYears("f.birthdate", "f.encounter_datetime")));
		List<String> names = new ArrayList<String>();
		for (String c : columns) {
			names.add(c.substring(c.lastIndexOf(" AS ") + 4));
		}
		// total + 2 sexes + 5 bands + 2x5 combinations
		assertEquals(18, names.size());
		assertEquals("MAL_004_NUM", names.get(0));
		assertTrue(names.contains("MAL_004_NUM_F"));
		assertTrue(names.contains("MAL_004_NUM_50PLUS"));
		assertTrue(names.contains("MAL_004_NUM_M_1_4"));
		String femaleUnder1 = columns.get(names.indexOf("MAL_004_NUM_F_LT1"));
		assertEquals("COALESCE(SUM(CASE WHEN (f.positive = 1) AND (f.gender = 'F') AND ((TIMESTAMPDIFF(YEAR, "
		        + "f.birthdate, f.encounter_datetime) < 1)) THEN 1 ELSE 0 END), 0) AS MAL_004_NUM_F_LT1",
		    femaleUnder1);
	}
	
	@Test
	public void disaggregated_shouldCountDistinctIdsWhenGivenOne() {
		List<String> columns = IndicatorSql.disaggregated("NCD_002_DEN", "f.client_id", "1 = 1");
		assertEquals(1, columns.size());
		assertEquals("COUNT(DISTINCT CASE WHEN (1 = 1) THEN f.client_id END) AS NCD_002_DEN", columns.get(0));
	}
	
	@Test
	public void percent_shouldBeNullOverAZeroDenominator() {
		assertEquals("CASE WHEN (d) = 0 THEN NULL ELSE 100.0 * (n) / (d) END AS MAL_004_PCT",
		    IndicatorSql.percent(IndicatorSql.column("MAL-004", "PCT"), "n", "d"));
	}
	
	@Test(expected = IllegalArgumentException.class)
	public void of_shouldRefuseASuffixThatWouldBreakTheNaming() {
		Disaggregation.of("-f", "x");
	}
}
