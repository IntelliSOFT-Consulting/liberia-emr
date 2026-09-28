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

/**
 * The fixed identifiers the MFL sync shares with content-liberia-national (LE-320) and the MFL
 * itself. ADR 0009 decisions 3 and 4 are the source; a change here is a change there.
 */
public final class MflConstants {
	
	// Location attribute types (ADR 0009 decision 4), created by content-liberia-national.
	
	public static final String ATTR_MFL_UID = "06568ddd-cc3b-4957-ad92-17e7249106c1";
	
	public static final String ATTR_MFL_CODE = "3118cabe-9a5d-420c-8a55-86234deb9b1b";
	
	public static final String ATTR_FACILITY_TYPE = "98dd0863-47bd-4038-9759-16ebe6c9d51b";
	
	public static final String ATTR_FACILITY_OWNERSHIP = "a75cb46c-dd20-42eb-abe5-94fed07bc059";
	
	public static final String ATTR_EMONC_LEVEL = "827bd8d1-053e-4441-88aa-fb9cac44a60a";
	
	public static final String ATTR_FACILITY_SETTING = "4880dd80-2b53-4dcf-aba9-5be5bd79c981";
	
	public static final String ATTR_MFL_CLOSED_DATE = "7d15cde2-fa20-4b98-acd0-be2dbd3597aa";
	
	public static final String ATTR_MFL_LAST_UPDATED = "a7c23ee9-dabd-4605-b039-325b2303850f";
	
	/** Every attribute type the sync owns, in the order the run log reports them. */
	public static final String[] ATTRIBUTE_TYPES = { ATTR_MFL_UID, ATTR_MFL_CODE, ATTR_FACILITY_TYPE,
	        ATTR_FACILITY_OWNERSHIP, ATTR_EMONC_LEVEL, ATTR_FACILITY_SETTING, ATTR_MFL_CLOSED_DATE, ATTR_MFL_LAST_UPDATED };
	
	/** The attribute type holding a date; the rest are text. */
	public static final String DATE_ATTRIBUTE_TYPE = ATTR_MFL_CLOSED_DATE;
	
	// Location tags, existing in content-liberia-national, found by name.
	
	public static final String TAG_COUNTY = "County";
	
	public static final String TAG_DISTRICT = "District";
	
	public static final String TAG_HEALTH_FACILITY = "Health Facility";
	
	/** Marks this instance's own facilities: the sync never retires an ancestor of one. */
	public static final String TAG_LOGIN_LOCATION = "Login Location";
	
	// MFL org unit groups, by UID: the names carry typos and trailing spaces (LE-318).
	
	public static final String GROUP_HOSPITAL = "oj9yiq3uMLI";
	
	public static final String GROUP_HEALTH_CENTER = "EltS2EPR5gR";
	
	public static final String GROUP_CLINIC = "cLPxlR1Brv9";
	
	public static final String GROUP_PUBLIC = "xSUk0MvIAUh";
	
	public static final String GROUP_PRIVATE = "lIYtHp5tvaG";
	
	public static final String GROUP_FAITH_BASED = "h4oGe3jDqml";
	
	public static final String GROUP_CONCESSION = "r4GnS2GDzJO";
	
	public static final String GROUP_BEMONC = "lAnbydCDQwW";
	
	public static final String GROUP_CEMONC = "M8CdHRhgkwW";
	
	public static final String GROUP_RURAL = "W1RG9PaTxzr";
	
	public static final String GROUP_URBAN = "L7IimdCGSjT";
	
	/** Every location the sync writes gets this country. */
	public static final String COUNTRY = "Liberia";
	
	/** The prefix of every retire reason the sync writes; it only un-retires what carries it. */
	public static final String RETIRE_REASON_PREFIX = "MFL:";
	
	// Privileges, created by content-liberia-national and granted to Sync Administrator.
	
	public static final String PRIVILEGE_VIEW = "View MFL Sync";
	
	public static final String PRIVILEGE_MANAGE = "Manage MFL Sync";
	
	private MflConstants() {
	}
}
