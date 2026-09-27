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

/** The MFL levels the sync creates, in the order it creates them. The country is not one. */
public enum MflLevel {

	COUNTY(2, MflConstants.TAG_COUNTY), DISTRICT(3, MflConstants.TAG_DISTRICT), FACILITY(4,
	        MflConstants.TAG_HEALTH_FACILITY);

	private final int dhis2Level;

	private final String tag;

	MflLevel(int dhis2Level, String tag) {
		this.dhis2Level = dhis2Level;
		this.tag = tag;
	}

	public int getDhis2Level() {
		return dhis2Level;
	}

	/** The location tag every location at this level carries. */
	public String getTag() {
		return tag;
	}

	/** @return the level, or null for a DHIS2 level the sync does not create */
	public static MflLevel ofDhis2Level(int level) {
		for (MflLevel candidate : values()) {
			if (candidate.dhis2Level == level) {
				return candidate;
			}
		}
		return null;
	}

	/** @return the level whose tag this is, or null */
	public static MflLevel ofTag(String tag) {
		for (MflLevel candidate : values()) {
			if (candidate.tag.equals(tag)) {
				return candidate;
			}
		}
		return null;
	}
}
