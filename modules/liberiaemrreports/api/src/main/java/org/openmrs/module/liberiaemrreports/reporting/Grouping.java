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

import org.openmrs.module.liberiaemrreports.scope.LocationScope;

/**
 * How an {@link IndicatorQuery} aggregates: one row for the whole scope
 * ({@link LiberiaReportManager#INDICATORS}), or one row per facility in it
 * ({@link LiberiaReportManager#BY_FACILITY}, central only).
 * <p>
 * An indicator writes its SQL once, through these methods, and gets both. Per facility, everything
 * "within the scope" (a person's latest reading, a previous diagnosis in the same episode, the
 * first-ever diagnosis) is judged within that facility, so a facility's row equals the
 * {@link #TOTAL} of a run scoped to it.
 */
public enum Grouping {

	/** One row for the run's scope. */
	TOTAL,

	/** One row per facility, keyed {@value #KEY}. */
	BY_FACILITY;

	/** The column a {@link #BY_FACILITY} query returns its facility in. */
	public static final String KEY = "facility_location_id";

	/**
	 * @param alias a table with {@code location_id}
	 * @return {@code alias.location_id IN ${scopeLocations}}
	 */
	public String inScope(String alias) {
		return alias + ".location_id IN " + LocationScope.TOKEN;
	}

	/**
	 * For a correlated lookup ({@code EXISTS}) of other rows that count with this one: in scope and,
	 * per facility, at the same facility.
	 *
	 * @param inner the looked-up table, with {@code location_id} and {@code facility_location_id}
	 * @param outer the row being counted, with {@code facility_location_id}
	 */
	public String inSameScope(String inner, String outer) {
		String sql = inScope(inner);
		return this == BY_FACILITY ? sql + " AND " + inner + "." + KEY + " = " + outer + "." + KEY : sql;
	}

	/**
	 * @param facilityExpr the counted row's facility, e.g. {@code f.facility_location_id}
	 * @return the key column and a comma for the start of a select list, or nothing
	 */
	public String keyColumn(String facilityExpr) {
		return this == BY_FACILITY ? facilityExpr + " AS " + KEY + ", " : "";
	}

	/**
	 * @param facilityExpr as for {@link #keyColumn}
	 * @return the key and a comma for the start of a GROUP BY list, or nothing
	 */
	public String groupKey(String facilityExpr) {
		return this == BY_FACILITY ? facilityExpr + ", " : "";
	}

	/**
	 * @param facilityExpr as for {@link #keyColumn}
	 * @return a GROUP BY clause on a new line, or nothing
	 */
	public String groupBy(String facilityExpr) {
		return this == BY_FACILITY ? "\nGROUP BY " + facilityExpr : "";
	}
}
