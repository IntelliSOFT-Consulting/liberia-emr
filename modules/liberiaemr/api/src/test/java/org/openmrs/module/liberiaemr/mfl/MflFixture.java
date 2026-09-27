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

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

/** The LE-318 fixture (integration/dhis2/mfl/fixtures), as the MFL returns it. */
final class MflFixture {

	private MflFixture() {
	}

	static JsonNode json(String file) {
		InputStream in = MflFixture.class.getClassLoader().getResourceAsStream("mfl-fixtures/" + file);
		if (in == null) {
			throw new IllegalStateException("mfl-fixtures/" + file + " is not on the test classpath");
		}
		try {
			return MflUnit.JSON.readTree(in);
		}
		catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}

	/** Every unit of the fixture, levels 1 to 4. */
	static List<MflUnit> units() {
		List<MflUnit> units = new ArrayList<MflUnit>();
		for (JsonNode node : json("organisationUnits.json").get("organisationUnits")) {
			units.add(MflUnit.fromJson(node));
		}
		return units;
	}

	static MflUnit unit(List<MflUnit> units, String uid) {
		for (MflUnit unit : units) {
			if (unit.getUid().equals(uid)) {
				return unit;
			}
		}
		throw new IllegalArgumentException(uid + " is not in the fixture");
	}

	/** A synthetic facility for the cases the fixture does not hold. */
	static MflUnit facility(String uid, String name, String parentUid, String... groups) {
		return new MflUnit(uid, null, name, 4, parentUid, null, "2026-01-01T00:00:00.000", null, null,
		        new LinkedHashSet<String>(Arrays.asList(groups)));
	}
}
