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

import org.openmrs.LocationAttributeType;
import org.openmrs.LocationTag;
import org.openmrs.api.LocationService;
import org.openmrs.customdatatype.datatype.DateDatatype;
import org.openmrs.customdatatype.datatype.FreeTextDatatype;
import org.openmrs.customdatatype.datatype.SpecifiedTextOptionsDatatype;

/**
 * The metadata content-liberia-national (LE-320) creates, made here so the tests need no content
 * package: the same UUIDs, datatypes and option values.
 */
final class MflTestMetadata {

	private MflTestMetadata() {
	}

	static void create(LocationService locations) {
		type(locations, MflConstants.ATTR_MFL_UID, "MFL UID", FreeTextDatatype.class, null);
		type(locations, MflConstants.ATTR_MFL_CODE, "MFL Code", FreeTextDatatype.class, null);
		type(locations, MflConstants.ATTR_FACILITY_TYPE, "Facility Type", SpecifiedTextOptionsDatatype.class,
		    "Hospital,Health Center,Clinic");
		type(locations, MflConstants.ATTR_FACILITY_OWNERSHIP, "Facility Ownership", SpecifiedTextOptionsDatatype.class,
		    "Public,Private,Faith Based,Concession");
		type(locations, MflConstants.ATTR_EMONC_LEVEL, "EmONC Level", SpecifiedTextOptionsDatatype.class, "BEmONC,CEmONC");
		type(locations, MflConstants.ATTR_FACILITY_SETTING, "Facility Setting", SpecifiedTextOptionsDatatype.class,
		    "Rural,Urban");
		type(locations, MflConstants.ATTR_MFL_CLOSED_DATE, "MFL Closed Date", DateDatatype.class, null);
		type(locations, MflConstants.ATTR_MFL_LAST_UPDATED, "MFL Last Updated", FreeTextDatatype.class, null);
		for (String tag : new String[] { MflConstants.TAG_COUNTY, MflConstants.TAG_DISTRICT,
		        MflConstants.TAG_HEALTH_FACILITY, MflConstants.TAG_LOGIN_LOCATION }) {
			if (locations.getLocationTagByName(tag) == null) {
				locations.saveLocationTag(new LocationTag(tag, tag));
			}
		}
	}

	private static void type(LocationService locations, String uuid, String name, Class<?> datatype, String config) {
		LocationAttributeType type = new LocationAttributeType();
		type.setUuid(uuid);
		type.setName(name);
		type.setDatatypeClassname(datatype.getName());
		type.setDatatypeConfig(config);
		type.setMinOccurs(0);
		type.setMaxOccurs(1);
		locations.saveLocationAttributeType(type);
	}
}
