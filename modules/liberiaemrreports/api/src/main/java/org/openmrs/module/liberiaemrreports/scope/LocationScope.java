/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.scope;

import java.util.LinkedHashMap;
import java.util.Map;

import org.openmrs.Location;

/**
 * The set of locations one report run may count, as resolved by {@link LocationScopeResolver}.
 * <p>
 * Report SQL never builds its own location filter. It writes {@value #TOKEN} where it needs the
 * in-scope location ids, against the attribution location of each event (ADR 0010 decision 5):
 * <pre>
 * WHERE f.location_id IN ${scopeLocations}
 * </pre> The token expands to a subquery over {@code mamba_dim_location_hierarchy} (built by the
 * ETL module, contract in {@code docs/reporting/README.md} §2.3), so a node counts every location
 * whose facility, district or county ancestor it is. That is how central rolls up; a facility uses
 * the same expansion, so a facility's report equals central's report filtered to it.
 */
public final class LocationScope {
	
	/** The token report SQL writes for the in-scope location ids. */
	public static final String TOKEN = "${scopeLocations}";
	
	/** Bound to the scope location's id, or -1 for a national run. */
	public static final String PARAM_LOCATION_ID = "scopeLocationId";
	
	/** Bound to 1 for a national (central, no location) run and 0 otherwise. */
	public static final String PARAM_NATIONAL = "scopeNational";
	
	/**
	 * Column names in {@code mamba_dim_location_hierarchy}. They are the ETL module's contract, named
	 * once here so a rename is a one-line change.
	 */
	public static final String HIERARCHY_TABLE = "mamba_dim_location_hierarchy";
	
	public static final String COL_LOCATION_ID = "location_id";
	
	public static final String COL_FACILITY_ID = "facility_location_id";
	
	public static final String COL_DISTRICT_ID = "district_location_id";
	
	public static final String COL_COUNTY_ID = "county_location_id";
	
	/** What {@value #TOKEN} expands to, before {@code ${etl}} is qualified. */
	public static final String SUBQUERY = "(SELECT lh." + COL_LOCATION_ID + " FROM ${etl}." + HIERARCHY_TABLE + " lh"
	        + " WHERE :" + PARAM_NATIONAL + " = 1" + matches(COL_LOCATION_ID) + matches(COL_FACILITY_ID)
	        + matches(COL_DISTRICT_ID) + matches(COL_COUNTY_ID) + ")";
	
	private static String matches(String column) {
		return " OR lh." + column + " = :" + PARAM_LOCATION_ID;
	}
	
	private final InstanceRole role;
	
	private final Location location;
	
	LocationScope(InstanceRole role, Location location) {
		this.role = role;
		this.location = location;
	}
	
	public InstanceRole getRole() {
		return role;
	}
	
	/**
	 * @return the node the run is scoped to, or null for a national run
	 */
	public Location getLocation() {
		return location;
	}
	
	public boolean isNational() {
		return location == null;
	}
	
	/**
	 * @param sql report SQL that may contain {@value #TOKEN}
	 * @return the SQL with the token expanded; {@code ${etl}} is left for the schema helper
	 */
	public static String expand(String sql) {
		return sql == null ? null : sql.replace(TOKEN, SUBQUERY);
	}
	
	/**
	 * @return the named parameters {@link #SUBQUERY} needs
	 */
	public Map<String, Object> getParameterValues() {
		Map<String, Object> values = new LinkedHashMap<String, Object>();
		values.put(PARAM_NATIONAL, isNational() ? 1 : 0);
		values.put(PARAM_LOCATION_ID, isNational() ? -1 : location.getLocationId());
		return values;
	}
	
	@Override
	public String toString() {
		return role + ":" + (isNational() ? "national" : location.getUuid());
	}
}
