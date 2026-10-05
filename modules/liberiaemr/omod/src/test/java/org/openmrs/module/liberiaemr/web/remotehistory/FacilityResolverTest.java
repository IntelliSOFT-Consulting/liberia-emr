/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import org.junit.Test;
import org.openmrs.Location;
import org.openmrs.LocationTag;

public class FacilityResolverTest {

	private static final String TAG = "tag-health-facility";

	private final FacilityResolver resolver = new FacilityResolver(TAG);

	private static Location location(String uuid, Location parent, boolean facility) {
		Location location = new Location();
		location.setUuid(uuid);
		location.setParentLocation(parent);
		if (facility) {
			LocationTag tag = new LocationTag();
			tag.setUuid(TAG);
			location.addTag(tag);
		}
		return location;
	}

	@Test
	public void aFacilityIsItsOwnFacility() {
		Location facility = location("f", location("county", null, false), true);

		assertSame(facility, resolver.facilityOf(facility));
	}

	@Test
	public void aWardBelongsToTheNearestTaggedAncestor() {
		Location county = location("county", null, true);
		Location facility = location("f", county, true);
		Location ward = location("ward", location("unit", facility, false), false);

		assertSame(facility, resolver.facilityOf(ward));
	}

	@Test
	public void noTaggedAncestorGivesNull() {
		assertNull(resolver.facilityOf(location("x", location("y", null, false), false)));
		assertNull(resolver.facilityOf(null));
	}

	@Test
	public void aCycleInTheTreeEndsTheWalk() {
		Location a = location("a", null, false);
		Location b = location("b", a, false);
		a.setParentLocation(b);

		assertNull(resolver.facilityOf(a));
	}

	@Test
	public void theInstanceRoleFailsClosedToFacility() {
		assertEquals(InstanceRole.CENTRAL, InstanceRole.parse(" Central "));
		assertEquals(InstanceRole.FACILITY, InstanceRole.parse(null));
		assertEquals(InstanceRole.FACILITY, InstanceRole.parse(""));
		assertEquals(InstanceRole.FACILITY, InstanceRole.parse("centrall"));
		assertEquals(InstanceRole.FACILITY, InstanceRole.parse("facility"));
	}
}
