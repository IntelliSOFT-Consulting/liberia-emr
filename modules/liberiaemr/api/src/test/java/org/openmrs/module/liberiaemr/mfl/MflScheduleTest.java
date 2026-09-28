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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.time.ZonedDateTime;
import java.util.Date;

import org.junit.Test;

public class MflScheduleTest {

	private static Date monrovia(int day, int hour, int minute) {
		return Date.from(ZonedDateTime.of(2026, 9, day, hour, minute, 0, 0, MflSettings.ZONE).toInstant());
	}

	@Test
	public void theTask_shouldBeNamedAsQaAndTheRunbookExpect() {
		assertEquals("LiberiaEMR MFL Sync", MflSyncTask.NAME);
	}

	@Test
	public void runsAt_shouldCompareTheTimeOfDayInMonrovia() {
		assertTrue(MflSchedule.runsAt(monrovia(1, 2, 0), "02:00"));
		assertTrue("another day, same time", MflSchedule.runsAt(monrovia(20, 2, 0), "02:00"));
		assertFalse(MflSchedule.runsAt(monrovia(1, 3, 30), "02:00"));
		assertFalse(MflSchedule.runsAt(null, "02:00"));
	}
}
