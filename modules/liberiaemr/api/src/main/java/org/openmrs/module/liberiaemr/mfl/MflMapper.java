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

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Turns the MFL's org units into location specs (ADR 0009 decision 3). Pure: it reads nothing but
 * its arguments, so every rule is tested against the LE-318 fixture without a database.
 */
public final class MflMapper {

	private static final Pattern WHITESPACE = Pattern.compile("[\\s\\u00A0]+");

	// Liberia's bounding box with a margin; a point outside it is stored and warned about.
	private static final double MIN_LATITUDE = 4.0, MAX_LATITUDE = 8.7, MIN_LONGITUDE = -11.7, MAX_LONGITUDE = -7.2;

	/** A group-mapped attribute: its groups, their labels and values, strongest first. */
	private static final class Dimension {

		final String attributeType;

		final String name;

		final Map<String, String[]> groups = new LinkedHashMap<String, String[]>();

		Dimension(String attributeType, String name) {
			this.attributeType = attributeType;
			this.name = name;
		}

		Dimension group(String uid, String label, String value) {
			groups.put(uid, new String[] { label, value });
			return this;
		}
	}

	private static final Dimension TYPE = new Dimension(MflConstants.ATTR_FACILITY_TYPE, "Facility Type")
	        .group(MflConstants.GROUP_HOSPITAL, "Hospital", "Hospital")
	        .group(MflConstants.GROUP_HEALTH_CENTER, "Health Center", "Health Center")
	        .group(MflConstants.GROUP_CLINIC, "Clinic", "Clinic");

	private static final Dimension OWNERSHIP = new Dimension(MflConstants.ATTR_FACILITY_OWNERSHIP, "Facility Ownership")
	        .group(MflConstants.GROUP_PUBLIC, "Public", "Public").group(MflConstants.GROUP_PRIVATE, "Private", "Private")
	        .group(MflConstants.GROUP_FAITH_BASED, "Faith Based", "Faith Based")
	        .group(MflConstants.GROUP_CONCESSION, "Concession", "Concession");

	private static final Dimension EMONC = new Dimension(MflConstants.ATTR_EMONC_LEVEL, "EmONC Level")
	        .group(MflConstants.GROUP_CEMONC, "CEmONC", "CEmONC").group(MflConstants.GROUP_BEMONC, "BemONC", "BEmONC");

	private static final Dimension SETTING = new Dimension(MflConstants.ATTR_FACILITY_SETTING, "Facility Setting")
	        .group(MflConstants.GROUP_RURAL, "Rural", "Rural").group(MflConstants.GROUP_URBAN, "Urban", "Urban");

	private MflMapper() {
	}

	/**
	 * @param units every unit of the pull, any level
	 * @param localNames the names of this instance's active locations that carry no MFL UID, in
	 *            any case
	 * @return one spec per county, per district that holds a facility, and per facility; counties
	 *         first, then districts, then facilities
	 */
	public static List<MflLocationSpec> map(Collection<MflUnit> units, Set<String> localNames) {
		Map<String, MflUnit> byUid = new HashMap<String, MflUnit>();
		Set<String> districtsWithFacilities = new HashSet<String>();
		for (MflUnit unit : units) {
			byUid.put(unit.getUid(), unit);
			if (unit.getLevel() == MflLevel.FACILITY.getDhis2Level() && unit.getParentUid() != null) {
				districtsWithFacilities.add(unit.getParentUid());
			}
		}

		List<MflUnit> kept = new ArrayList<MflUnit>();
		for (MflUnit unit : units) {
			MflLevel level = MflLevel.ofDhis2Level(unit.getLevel());
			if (level == null || level == MflLevel.DISTRICT && !districtsWithFacilities.contains(unit.getUid())) {
				continue;
			}
			kept.add(unit);
		}
		Collections.sort(kept, new Comparator<MflUnit>() {

			@Override
			public int compare(MflUnit a, MflUnit b) {
				return a.getLevel() != b.getLevel() ? a.getLevel() - b.getLevel() : a.getUid().compareTo(b.getUid());
			}
		});

		// A name is shared when two kept units hold it, closed ones included (OpenMRS refuses to save
		// even a retired location under an active one's name), or a local location already does.
		Map<String, Integer> nameCounts = new HashMap<String, Integer>();
		for (MflUnit unit : kept) {
			String key = key(normalise(unit.getName()));
			nameCounts.put(key, nameCounts.containsKey(key) ? nameCounts.get(key) + 1 : 1);
		}
		Set<String> localKeys = new HashSet<String>();
		for (String name : localNames) {
			localKeys.add(key(normalise(name)));
		}

		List<MflLocationSpec> specs = new ArrayList<MflLocationSpec>();
		for (MflUnit unit : kept) {
			specs.add(spec(unit, byUid, nameCounts, localKeys));
		}
		return specs;
	}

	private static MflLocationSpec spec(MflUnit unit, Map<String, MflUnit> byUid, Map<String, Integer> nameCounts,
	        Set<String> localKeys) {
		MflLevel level = MflLevel.ofDhis2Level(unit.getLevel());
		List<String> warnings = new ArrayList<String>();
		MflUnit parent = level == MflLevel.COUNTY ? null : byUid.get(unit.getParentUid());

		String name = normalise(unit.getName());
		String key = key(name);
		if (nameCounts.get(key) > 1 || localKeys.contains(key)) {
			if (parent == null) {
				warnings.add("Name: another location is also called '" + name + "'; left as is, a county has no parent to tell it apart");
			} else {
				String distinct = name + " (" + normalise(parent.getName()) + ")";
				warnings.add("Name: another location is also called '" + name + "'; named '" + distinct + "'");
				name = distinct;
			}
		}

		String stateProvince;
		String countyDistrict;
		if (level == MflLevel.COUNTY) {
			stateProvince = normalise(unit.getName());
			countyDistrict = null;
		} else if (level == MflLevel.DISTRICT) {
			stateProvince = parent == null ? null : normalise(parent.getName());
			countyDistrict = normalise(unit.getName());
		} else {
			MflUnit county = parent == null ? null : byUid.get(parent.getParentUid());
			stateProvince = county == null ? null : normalise(county.getName());
			countyDistrict = parent == null ? null : normalise(parent.getName());
		}

		Map<String, String> attributes = new LinkedHashMap<String, String>();
		attributes.put(MflConstants.ATTR_MFL_UID, unit.getUid());
		attributes.put(MflConstants.ATTR_MFL_CODE, blankToNull(unit.getCode()));
		attributes.put(MflConstants.ATTR_MFL_CLOSED_DATE, unit.getClosedDate());
		attributes.put(MflConstants.ATTR_MFL_LAST_UPDATED, unit.getLastUpdated());

		String latitude = null;
		String longitude = null;
		if (level == MflLevel.FACILITY) {
			attributes.put(TYPE.attributeType, strongest(TYPE, unit, warnings));
			attributes.put(OWNERSHIP.attributeType, ownership(unit, warnings));
			attributes.put(EMONC.attributeType, strongest(EMONC, unit, warnings));
			attributes.put(SETTING.attributeType, onlyOne(SETTING, unit, warnings));
			latitude = unit.getLatitude();
			longitude = unit.getLongitude();
			if (latitude != null && longitude != null && outsideLiberia(latitude, longitude)) {
				warnings.add("Point " + latitude + ", " + longitude + " is outside Liberia");
			}
		}

		return new MflLocationSpec(unit.getUid(), level, name, parent == null ? null : parent.getUid(), latitude,
		        longitude, stateProvince, countyDistrict, unit.getClosedDate(), attributes, warnings);
	}

	/** Hospital > Health Center > Clinic, and CEmONC > BemONC: the first in declaration order wins. */
	private static String strongest(Dimension dimension, MflUnit unit, List<String> warnings) {
		List<String[]> in = memberships(dimension, unit);
		if (in.isEmpty()) {
			return null;
		}
		if (in.size() > 1) {
			warnings.add(dimension.name + ": in " + labels(in) + "; " + in.get(0)[0] + " wins");
		}
		return in.get(0)[1];
	}

	/** Private paired with one other ownership: the other, more specific one wins. */
	private static String ownership(MflUnit unit, List<String> warnings) {
		List<String[]> in = memberships(OWNERSHIP, unit);
		if (in.size() <= 1) {
			return in.isEmpty() ? null : in.get(0)[1];
		}
		if (in.size() == 2 && unit.getGroups().contains(MflConstants.GROUP_PRIVATE)) {
			String[] other = "Private".equals(in.get(0)[0]) ? in.get(1) : in.get(0);
			warnings.add(OWNERSHIP.name + ": in " + labels(in) + "; " + other[0] + " wins");
			return other[1];
		}
		warnings.add(OWNERSHIP.name + ": in " + labels(in) + "; left empty");
		return null;
	}

	/** Rural and Urban together say nothing, so the attribute is left empty. */
	private static String onlyOne(Dimension dimension, MflUnit unit, List<String> warnings) {
		List<String[]> in = memberships(dimension, unit);
		if (in.size() > 1) {
			warnings.add(dimension.name + ": in " + labels(in) + "; left empty");
			return null;
		}
		return in.isEmpty() ? null : in.get(0)[1];
	}

	private static List<String[]> memberships(Dimension dimension, MflUnit unit) {
		List<String[]> in = new ArrayList<String[]>();
		for (Map.Entry<String, String[]> group : dimension.groups.entrySet()) {
			if (unit.getGroups().contains(group.getKey())) {
				in.add(group.getValue());
			}
		}
		return in;
	}

	/** The group labels in alphabetical order, so a warning reads the same on every run. */
	private static String labels(List<String[]> in) {
		TreeMap<String, String> sorted = new TreeMap<String, String>();
		for (String[] group : in) {
			sorted.put(group[0], group[0]);
		}
		List<String> labels = new ArrayList<String>(sorted.keySet());
		StringBuilder out = new StringBuilder();
		for (int i = 0; i < labels.size(); i++) {
			if (i > 0) {
				out.append(i == labels.size() - 1 ? " and " : ", ");
			}
			out.append(labels.get(i));
		}
		return out.toString();
	}

	private static boolean outsideLiberia(String latitude, String longitude) {
		try {
			double lat = new BigDecimal(latitude).doubleValue();
			double lon = new BigDecimal(longitude).doubleValue();
			return lat < MIN_LATITUDE || lat > MAX_LATITUDE || lon < MIN_LONGITUDE || lon > MAX_LONGITUDE;
		}
		catch (NumberFormatException e) {
			return true;
		}
	}

	/** Trims and collapses every run of whitespace to one space. */
	static String normalise(String name) {
		return name == null ? null : WHITESPACE.matcher(name).replaceAll(" ").trim();
	}

	private static String key(String name) {
		return name == null ? "" : name.toLowerCase(Locale.ROOT);
	}

	private static String blankToNull(String value) {
		return value == null || value.trim().isEmpty() ? null : value.trim();
	}
}
