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

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** One DHIS2 organisation unit, as the MFL returns it and before any mapping. */
public class MflUnit {

	/** Keeps coordinates as the MFL wrote them: a double would turn 6.814444 into 6.8144439999…. */
	public static final ObjectMapper JSON = new ObjectMapper()
	        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

	private final String uid;

	private final String code;

	private final String name;

	private final int level;

	private final String parentUid;

	private final String closedDate;

	private final String lastUpdated;

	private final String latitude;

	private final String longitude;

	private final Set<String> groups;

	/**
	 * @param closedDate yyyy-mm-dd, or null when open
	 * @param latitude as the MFL wrote it, or null
	 * @param longitude as the MFL wrote it, or null
	 */
	public MflUnit(String uid, String code, String name, int level, String parentUid, String closedDate,
	    String lastUpdated, String latitude, String longitude, Set<String> groups) {
		this.uid = uid;
		this.code = code;
		this.name = name;
		this.level = level;
		this.parentUid = parentUid;
		this.closedDate = closedDate;
		this.lastUpdated = lastUpdated;
		this.latitude = latitude;
		this.longitude = longitude;
		this.groups = Collections.unmodifiableSet(new LinkedHashSet<String>(groups));
	}

	/** Reads a unit from the organisationUnits API; the point is [longitude, latitude]. */
	public static MflUnit fromJson(JsonNode node) {
		String latitude = null;
		String longitude = null;
		JsonNode geometry = node.get("geometry");
		if (geometry != null && geometry.isObject() && "Point".equals(text(geometry, "type"))) {
			JsonNode coordinates = geometry.get("coordinates");
			if (coordinates != null && coordinates.isArray() && coordinates.size() == 2) {
				longitude = coordinates.get(0).decimalValue().toPlainString();
				latitude = coordinates.get(1).decimalValue().toPlainString();
			}
		}
		Set<String> groups = new LinkedHashSet<String>();
		JsonNode memberships = node.get("organisationUnitGroups");
		if (memberships != null) {
			for (JsonNode group : memberships) {
				groups.add(text(group, "id"));
			}
		}
		JsonNode parent = node.get("parent");
		String closed = text(node, "closedDate");
		return new MflUnit(text(node, "id"), text(node, "code"), text(node, "name"), node.path("level").asInt(),
		        parent == null ? null : text(parent, "id"), closed == null || closed.length() < 10 ? closed
		                : closed.substring(0, 10), text(node, "lastUpdated"), latitude, longitude, groups);
	}

	private static String text(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? null : value.asText();
	}

	public String getUid() {
		return uid;
	}

	public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}

	public int getLevel() {
		return level;
	}

	public String getParentUid() {
		return parentUid;
	}

	public String getClosedDate() {
		return closedDate;
	}

	public String getLastUpdated() {
		return lastUpdated;
	}

	public String getLatitude() {
		return latitude;
	}

	public String getLongitude() {
		return longitude;
	}

	public Set<String> getGroups() {
		return groups;
	}
}
