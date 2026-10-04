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

import java.util.HashSet;
import java.util.Set;

import org.openmrs.Location;
import org.openmrs.api.context.Context;
import org.openmrs.util.PrivilegeConstants;
import org.springframework.stereotype.Component;

/**
 * Turns a report's optional {@code location} parameter into the {@link LocationScope} it may count
 * (ADR 0010 decision 5, {@code docs/reporting/README.md} §3.2).
 * <ul>
 * <li><b>Facility:</b> the location defaults to the facility root named by
 * {@value #GP_FACILITY_LOCATION} and is clamped to it and its descendants. Any other location fails
 * the run, and so does an unset or unresolvable global property.</li>
 * <li><b>Central:</b> any location is accepted and rolls up through the ETL location hierarchy; no
 * location means national.</li>
 * </ul>
 */
@Component(LocationScopeResolver.BEAN_NAME)
public class LocationScopeResolver {
	
	/** This bean's name in the Spring context, for {@code Context.getRegisteredComponent}. */
	public static final String BEAN_NAME = "liberiaemrreportsLocationScopeResolver";
	
	/** Seeded by each site package from its facility root; see omod config.xml. */
	public static final String GP_FACILITY_LOCATION = "liberiaemr.facility.locationUuid";
	
	/** Guards the parent walk against a cycle in location data. */
	private static final int MAX_DEPTH = 64;
	
	/** Finds a location by UUID; the OpenMRS location service outside tests. */
	public interface LocationLookup {
		
		Location byUuid(String uuid);
	}
	
	/** Null in production, where the role comes from the environment. */
	private volatile InstanceRole roleOverride;
	
	/**
	 * @return this instance's role, after the fail-closed check
	 */
	public InstanceRole getRole() {
		InstanceRole role = roleOverride;
		return role == null ? InstanceRole.current() : role;
	}
	
	/**
	 * Pins the role instead of reading {@value InstanceRole#ENVIRONMENT_VARIABLE}. For tests, which
	 * cannot set a process environment variable; pass null to restore the environment.
	 */
	public void setRoleOverride(InstanceRole roleOverride) {
		this.roleOverride = roleOverride;
	}
	
	/**
	 * Resolves a scope for this instance's role, reading the facility root from the global property.
	 */
	public LocationScope resolve(Location requested) {
		InstanceRole role = getRole();
		return resolve(role, requested, role == InstanceRole.FACILITY ? getFacilityRootUuid() : null, CORE_LOOKUP);
	}
	
	/**
	 * @return the location {@value #GP_FACILITY_LOCATION} names, or null when it is unset or does not
	 *         resolve
	 */
	public Location getFacilityRoot() {
		String uuid = getFacilityRootUuid();
		return uuid == null || uuid.trim().isEmpty() ? null : CORE_LOOKUP.byUuid(uuid.trim());
	}
	
	/**
	 * Reads the global property as the system: a National Reporting Officer holds neither Get Global
	 * Properties nor necessarily Get Locations, and needs neither to run a report.
	 */
	private static String getFacilityRootUuid() {
		Context.addProxyPrivilege(PrivilegeConstants.GET_GLOBAL_PROPERTIES);
		try {
			return Context.getAdministrationService().getGlobalProperty(GP_FACILITY_LOCATION);
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.GET_GLOBAL_PROPERTIES);
		}
	}
	
	private static final LocationLookup CORE_LOOKUP = uuid -> {
		Context.addProxyPrivilege(PrivilegeConstants.GET_LOCATIONS);
		try {
			return Context.getLocationService().getLocationByUuid(uuid);
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.GET_LOCATIONS);
		}
	};
	
	/**
	 * @param role this instance's role
	 * @param requested the report's {@code location} parameter, possibly null
	 * @param facilityRootUuid the value of {@value #GP_FACILITY_LOCATION}; ignored at central
	 * @param lookup resolves the facility root
	 * @return the scope to count
	 * @throws ReportScopeException if a facility cannot identify itself, or the requested location is
	 *             outside it
	 */
	public static LocationScope resolve(InstanceRole role, Location requested, String facilityRootUuid,
	        LocationLookup lookup) {
		if (role == InstanceRole.CENTRAL) {
			return new LocationScope(role, requested);
		}
		
		if (facilityRootUuid == null || facilityRootUuid.trim().isEmpty()) {
			throw new ReportScopeException("This facility does not know its own location: the global property "
			        + GP_FACILITY_LOCATION + " is not set. It is seeded by the site content package.");
		}
		Location root = lookup.byUuid(facilityRootUuid.trim());
		if (root == null) {
			throw new ReportScopeException("The global property " + GP_FACILITY_LOCATION + " names location "
			        + facilityRootUuid.trim() + ", which does not exist on this server.");
		}
		if (requested == null) {
			return new LocationScope(role, root);
		}
		if (!isSameOrDescendant(requested, root)) {
			throw new ReportScopeException("A facility can only report on itself: location '" + requested.getName()
			        + "' is not " + root.getName() + " or one of its sub-locations.");
		}
		return new LocationScope(role, requested);
	}
	
	static boolean isSameOrDescendant(Location candidate, Location root) {
		Set<String> seen = new HashSet<String>();
		Location current = candidate;
		for (int depth = 0; current != null && depth < MAX_DEPTH; depth++) {
			if (root.getUuid().equals(current.getUuid())) {
				return true;
			}
			if (!seen.add(current.getUuid())) {
				return false;
			}
			current = current.getParentLocation();
		}
		return false;
	}
}
