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

import java.util.HashSet;
import java.util.Set;

import org.openmrs.Location;
import org.openmrs.LocationTag;

/**
 * The facility a location belongs to: its nearest ancestor-or-self tagged Health Facility, compared
 * by the tag's UUID. The same rule as the identity service's FacilityOfOrigin and the ETL's
 * facility_location_id (ADR 0012), walked over the Location objects instead of SQL.
 */
class FacilityResolver {
	
	/** The MFL tree is five deep; this is generous. */
	static final int MAX_HOPS = 10;
	
	private final String healthFacilityTagUuid;
	
	FacilityResolver(String healthFacilityTagUuid) {
		this.healthFacilityTagUuid = healthFacilityTagUuid;
	}
	
	/** @return the location's facility, or null when no tagged ancestor is within reach */
	Location facilityOf(Location location) {
		Set<Location> seen = new HashSet<Location>();
		Location current = location;
		for (int hop = 0; hop <= MAX_HOPS && current != null && seen.add(current); hop++) {
			if (isFacility(current)) {
				return current;
			}
			current = current.getParentLocation();
		}
		return null;
	}
	
	private boolean isFacility(Location location) {
		if (location.getTags() == null) {
			return false;
		}
		for (LocationTag tag : location.getTags()) {
			if (healthFacilityTagUuid.equals(tag.getUuid())) {
				return true;
			}
		}
		return false;
	}
}
