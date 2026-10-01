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
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.function.Function;

import org.junit.Test;

public class IndicatorQueryTest {

	private static final Function<Grouping, String> COUNT_ROWS = g -> IndicatorQuery.select(g, "f.facility_location_id",
	    Collections.singletonList(IndicatorSql.count("X_NUM", "1 = 1")), "FROM ${etl}.t f WHERE " + g.inScope("f"));

	@Test
	public void select_shouldAddTheFacilityKeyOnlyByFacility() {
		assertEquals("SELECT COALESCE(SUM(CASE WHEN (1 = 1) THEN 1 ELSE 0 END), 0) AS X_NUM\n"
		        + "FROM ${etl}.t f WHERE f.location_id IN ${scopeLocations}",
		    COUNT_ROWS.apply(Grouping.TOTAL));
		assertEquals("SELECT f.facility_location_id AS facility_location_id,\n"
		        + "       COALESCE(SUM(CASE WHEN (1 = 1) THEN 1 ELSE 0 END), 0) AS X_NUM\n"
		        + "FROM ${etl}.t f WHERE f.location_id IN ${scopeLocations}\n" + "GROUP BY f.facility_location_id",
		    COUNT_ROWS.apply(Grouping.BY_FACILITY));
	}

	@Test
	public void inSameScope_shouldTieTheLookupToTheFacilityOnlyByFacility() {
		assertEquals("e.location_id IN ${scopeLocations}", Grouping.TOTAL.inSameScope("e", "d"));
		assertEquals("e.location_id IN ${scopeLocations} AND e.facility_location_id = d.facility_location_id",
		    Grouping.BY_FACILITY.inSameScope("e", "d"));
		assertEquals("", Grouping.TOTAL.groupKey("v.facility_location_id"));
		assertEquals("v.facility_location_id, ", Grouping.BY_FACILITY.groupKey("v.facility_location_id"));
		assertEquals("", Grouping.TOTAL.keyColumn("v.facility_location_id"));
		assertEquals("v.facility_location_id AS facility_location_id, ",
		    Grouping.BY_FACILITY.keyColumn("v.facility_location_id"));
	}

	@Test
	public void indicatorsSql_shouldPutEveryQuerysRowSideBySide() {
		List<IndicatorQuery> queries = Arrays.asList(IndicatorQuery.of(COUNT_ROWS, "X_NUM"),
		    IndicatorQuery.of(g -> "SELECT 1 AS Y_NUM, 2 AS Y_DEN, 50.0 AS Y_PCT", "Y_NUM", "Y_DEN", "Y_PCT"));
		String sql = IndicatorQuery.indicatorsSql(queries);
		assertTrue(sql, sql.startsWith("SELECT q0.X_NUM,\n       q1.Y_NUM,\n       q1.Y_DEN,\n       q1.Y_PCT\nFROM ("));
		assertTrue(sql, sql.contains(") q0\nCROSS JOIN (SELECT 1 AS Y_NUM, 2 AS Y_DEN, 50.0 AS Y_PCT) q1"));
	}

	@Test
	public void byFacilitySql_shouldListFacilitiesInScopeWithZeroCountsAndNoValueWhenEmpty() {
		List<IndicatorQuery> queries = Arrays.asList(IndicatorQuery.of(COUNT_ROWS, "X_NUM"),
		    IndicatorQuery.of(g -> "SELECT 1", "Y_NUM", "Y_PCT"));
		String sql = IndicatorQuery.byFacilitySql(queries);
		assertTrue(sql, sql.startsWith("SELECT fac.name AS facility_name,\n       fac.uuid AS facility_uuid,\n"
		        + "       COALESCE(q0.X_NUM, 0) AS X_NUM,\n       COALESCE(q1.Y_NUM, 0) AS Y_NUM,\n       q1.Y_PCT\n"));
		assertTrue(sql, sql.contains("GROUP BY f.facility_location_id) q0 ON q0.facility_location_id = fac.location_id"));
		assertTrue(sql, sql.endsWith("WHERE fac.location_id = fac.facility_location_id\n"
		        + "  AND fac.location_id IN ${scopeLocations}\nORDER BY fac.name"));
	}

	@Test
	public void of_shouldRefuseAQueryWithNoColumns() {
		String[] none = new String[0];
		assertThrows(IllegalArgumentException.class, () -> IndicatorQuery.of(COUNT_ROWS, none));
	}

	@Test
	public void getColumns_shouldBeUnmodifiable() {
		List<String> columns = IndicatorQuery.of(COUNT_ROWS, "X_NUM").getColumns();
		assertThrows(UnsupportedOperationException.class, () -> columns.add("X_DEN"));
		assertFalse(columns.isEmpty());
	}
}
