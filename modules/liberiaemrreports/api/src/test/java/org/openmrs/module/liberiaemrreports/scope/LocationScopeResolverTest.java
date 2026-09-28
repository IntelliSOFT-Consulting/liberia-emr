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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Location;

/**
 * The role and scope rules without a database: facility clamping, central roll-up selection and the
 * parameters the hierarchy subquery binds.
 */
public class LocationScopeResolverTest {
	
	private final Map<String, Location> byUuid = new HashMap<String, Location>();
	
	private final LocationScopeResolver.LocationLookup lookup = new LocationScopeResolver.LocationLookup() {
		
		@Override
		public Location byUuid(String uuid) {
			return byUuid.get(uuid);
		}
	};
	
	private Location county, district, facility, department, otherFacility;
	
	private Location location(int id, String name, Location parent) {
		Location l = new Location(id);
		l.setName(name);
		l.setUuid(UUID.randomUUID().toString());
		l.setParentLocation(parent);
		byUuid.put(l.getUuid(), l);
		return l;
	}
	
	@Before
	public void setUp() {
		county = location(1, "County", null);
		district = location(2, "District", county);
		facility = location(3, "Facility", district);
		department = location(4, "Department", facility);
		otherFacility = location(5, "Other facility", district);
	}
	
	// ---- facility ----
	
	@Test
	public void facility_shouldDefaultToItsOwnRoot() {
		LocationScope scope = LocationScopeResolver.resolve(InstanceRole.FACILITY, null, facility.getUuid(), lookup);
		assertSame(facility, scope.getLocation());
		assertFalse(scope.isNational());
		assertEquals(0, scope.getParameterValues().get(LocationScope.PARAM_NATIONAL));
		assertEquals(3, scope.getParameterValues().get(LocationScope.PARAM_LOCATION_ID));
	}
	
	@Test
	public void facility_shouldAcceptItselfAndItsSubLocations() {
		assertSame(facility,
		    LocationScopeResolver.resolve(InstanceRole.FACILITY, facility, facility.getUuid(), lookup).getLocation());
		assertSame(department, LocationScopeResolver
		        .resolve(InstanceRole.FACILITY, department, " " + facility.getUuid() + " ", lookup).getLocation());
	}
	
	@Test
	public void facility_shouldRefuseAnotherFacilityAndItsOwnAncestors() {
		for (Location outside : new Location[] { otherFacility, district, county }) {
			String facilityUuid = facility.getUuid();
			ReportScopeException expected = assertThrows(ReportScopeException.class,
			    () -> LocationScopeResolver.resolve(InstanceRole.FACILITY, outside, facilityUuid, lookup));
			assertTrue(expected.getMessage().contains(outside.getName()));
		}
	}
	
	@Test(expected = ReportScopeException.class)
	public void facility_shouldFailWhenItsLocationIsNotSet() {
		LocationScopeResolver.resolve(InstanceRole.FACILITY, null, "  ", lookup);
	}
	
	@Test(expected = ReportScopeException.class)
	public void facility_shouldFailWhenItsLocationIsNull() {
		LocationScopeResolver.resolve(InstanceRole.FACILITY, facility, null, lookup);
	}
	
	@Test(expected = ReportScopeException.class)
	public void facility_shouldFailWhenItsLocationDoesNotResolve() {
		LocationScopeResolver.resolve(InstanceRole.FACILITY, null, UUID.randomUUID().toString(), lookup);
	}
	
	@Test
	public void facility_shouldNotLoopOnACycleInLocationData() {
		Location a = location(10, "A", null);
		Location b = location(11, "B", a);
		a.setParentLocation(b);
		assertFalse(LocationScopeResolver.isSameOrDescendant(a, facility));
	}
	
	// ---- central ----
	
	@Test
	public void central_shouldBeNationalWithoutALocation() {
		LocationScope scope = LocationScopeResolver.resolve(InstanceRole.CENTRAL, null, null, lookup);
		assertTrue(scope.isNational());
		assertNull(scope.getLocation());
		assertEquals(1, scope.getParameterValues().get(LocationScope.PARAM_NATIONAL));
		assertEquals(-1, scope.getParameterValues().get(LocationScope.PARAM_LOCATION_ID));
	}
	
	@Test
	public void central_shouldAcceptAnyNodeAndIgnoreTheFacilityProperty() {
		for (Location node : new Location[] { county, district, facility, otherFacility }) {
			LocationScope scope = LocationScopeResolver.resolve(InstanceRole.CENTRAL, node, facility.getUuid(), lookup);
			assertSame(node, scope.getLocation());
			assertEquals(node.getLocationId(), scope.getParameterValues().get(LocationScope.PARAM_LOCATION_ID));
		}
	}
	
	@Test
	public void central_shouldNotNeedTheFacilityProperty() {
		assertTrue(LocationScopeResolver.resolve(InstanceRole.CENTRAL, null, "not-a-location", lookup).isNational());
	}
	
	// ---- SQL ----
	
	@Test
	public void expand_shouldRollUpThroughEveryHierarchyLevel() {
		String sql = LocationScope.expand("SELECT 1 FROM f WHERE f.location_id IN ${scopeLocations}");
		assertFalse(sql.contains(LocationScope.TOKEN));
		// Every descendant of the chosen node, at any level, through the ETL's closure table.
		assertTrue(sql.contains("SELECT la.location_id FROM ${etl}.mamba_dim_location_ancestor la"));
		assertTrue(sql.contains("la.ancestor_location_id = :scopeLocationId"));
		assertTrue(sql.contains(":scopeNational = 1"));
	}
}
