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

import org.junit.Test;

public class InstanceRoleTest {
	
	@Test
	public void parse_shouldRecogniseCentral() {
		assertEquals(InstanceRole.CENTRAL, InstanceRole.parse("central"));
		assertEquals(InstanceRole.CENTRAL, InstanceRole.parse(" CENTRAL "));
	}
	
	@Test
	public void parse_shouldRecogniseFacility() {
		assertEquals(InstanceRole.FACILITY, InstanceRole.parse("facility"));
	}
	
	@Test
	public void parse_shouldFailClosedToFacility() {
		String[] values = { null, "", "  ", "centrall", "national", "central,facility", "1" };
		for (String value : values) {
			assertEquals(String.valueOf(value), InstanceRole.FACILITY, InstanceRole.parse(value));
		}
	}
}
