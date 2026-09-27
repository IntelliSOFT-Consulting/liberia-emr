/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class IdentityScheduleTest {

	@Test
	public void seconds_readsTheConfiguredInterval() {
		assertEquals(300, IdentitySchedule.seconds(" 300 "));
	}

	@Test
	public void seconds_fallsBackToTheDefaultWhenUnsetOrNotANumber() {
		assertEquals(60, IdentitySchedule.seconds(null));
		assertEquals(60, IdentitySchedule.seconds(""));
		assertEquals(60, IdentitySchedule.seconds("5m"));
	}

	@Test
	public void seconds_neverRunsMoreOftenThanTheFloor() {
		assertEquals(10, IdentitySchedule.seconds("1"));
		assertEquals(10, IdentitySchedule.seconds("-30"));
	}

	@Test
	public void listensOnlyToItsOwnProperty() {
		IdentitySchedule schedule = new IdentitySchedule(null);
		assertTrue(schedule.supportsPropertyName(IdentitySchedule.GP_INTERVAL_SECONDS));
		assertFalse(schedule.supportsPropertyName("liberiaemr.identity.batchSize"));
	}
}
