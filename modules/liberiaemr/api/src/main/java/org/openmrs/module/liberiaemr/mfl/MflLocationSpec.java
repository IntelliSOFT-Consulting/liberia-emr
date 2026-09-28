/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What one MFL unit should look like as a location: every field the sync owns (ADR 0009 decision
 * 3), already normalised. A null field or attribute means "empty", not "leave alone".
 */
public class MflLocationSpec {

	private final String uid;

	private final MflLevel level;

	private final String name;

	private final String parentUid;

	private final String latitude;

	private final String longitude;

	private final String stateProvince;

	private final String countyDistrict;

	private final String closedDate;

	private final Map<String, String> attributes;

	private final List<String> warnings;

	public MflLocationSpec(String uid, MflLevel level, String name, String parentUid, String latitude, String longitude,
	    String stateProvince, String countyDistrict, String closedDate, Map<String, String> attributes,
	    List<String> warnings) {
		this.uid = uid;
		this.level = level;
		this.name = name;
		this.parentUid = parentUid;
		this.latitude = latitude;
		this.longitude = longitude;
		this.stateProvince = stateProvince;
		this.countyDistrict = countyDistrict;
		this.closedDate = closedDate;
		this.attributes = Collections.unmodifiableMap(new LinkedHashMap<String, String>(attributes));
		this.warnings = Collections.unmodifiableList(new ArrayList<String>(warnings));
	}

	public String getUid() {
		return uid;
	}

	public MflLevel getLevel() {
		return level;
	}

	public String getName() {
		return name;
	}

	/** Null for a county: counties are top-level. */
	public String getParentUid() {
		return parentUid;
	}

	public String getLatitude() {
		return latitude;
	}

	public String getLongitude() {
		return longitude;
	}

	public String getStateProvince() {
		return stateProvince;
	}

	public String getCountyDistrict() {
		return countyDistrict;
	}

	public String getCountry() {
		return MflConstants.COUNTRY;
	}

	/** yyyy-mm-dd when the MFL has closed the unit, else null. */
	public String getClosedDate() {
		return closedDate;
	}

	public boolean isClosed() {
		return closedDate != null;
	}

	public String getCode() {
		return attributes.get(MflConstants.ATTR_MFL_CODE);
	}

	/**
	 * The owned attributes by type UUID. A key with a null value is an attribute this location
	 * must not have; an absent key is one the sync does not own at this level.
	 */
	public Map<String, String> getAttributes() {
		return attributes;
	}

	public String getAttribute(String typeUuid) {
		return attributes.get(typeUuid);
	}

	/** Group tie-breaks, name disambiguation and odd points, for the run log. */
	public List<String> getWarnings() {
		return warnings;
	}
}
