/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.programs;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.junit.Test;
import org.openmrs.Encounter;

public class ProgramAutoCloseTest {

	private static Date at(int day, int hour) {
		return Date.from(LocalDateTime.of(2026, 10, day, hour, 0).atZone(ZoneId.systemDefault()).toInstant());
	}

	private static Encounter encounter(Date when) {
		Encounter encounter = new Encounter();
		encounter.setEncounterDatetime(when);
		return encounter;
	}

	@Test
	public void closingDate_noEncounters_isNull() {
		assertNull(ProgramAutoClose.closingDate(at(10, 9), Collections.emptyList()));
	}

	@Test
	public void closingDate_encounterBeforeEnrolmentDay_isIgnored() {
		assertNull(ProgramAutoClose.closingDate(at(10, 9), Arrays.asList(encounter(at(9, 23)))));
	}

	@Test
	public void closingDate_usesEarliestEncounterInEpisode() {
		Date closed = ProgramAutoClose.closingDate(at(10, 9),
		    Arrays.asList(encounter(at(18, 8)), encounter(at(15, 14)), encounter(at(2, 8))));
		assertEquals(at(15, 14), closed);
	}

	@Test
	public void closingDate_sameDayEarlierThanEnrolment_isNotBeforeEnrolment() {
		assertEquals(at(10, 9), ProgramAutoClose.closingDate(at(10, 9), Arrays.asList(encounter(at(10, 7)))));
	}

	@Test
	public void closingDate_skipsEncounterWithoutDate() {
		assertNull(ProgramAutoClose.closingDate(at(10, 9), Arrays.asList(encounter(null))));
	}

	@Test
	public void parseRules_blankOrMalformed_turnsAutoCloseOff() {
		assertTrue(ProgramAutoClose.parseRules(null).isEmpty());
		assertTrue(ProgramAutoClose.parseRules(" ").isEmpty());
		assertTrue(ProgramAutoClose.parseRules("[{").isEmpty());
	}

	@Test
	public void parseRules_needsProgramAndAClosingEncounter() {
		List<ProgramAutoClose.Rule> rules = ProgramAutoClose.parseRules("[" + "{\"program\":\"p\"},"
		        + "{\"closeOnForms\":[\"f\"]}," + "{\"program\":\"anc\",\"closeOnEncounterTypes\":[\"delivery\"],"
		        + "\"closeOnForms\":[\" third-stage \"]}]");
		assertEquals(1, rules.size());
		assertEquals("anc", rules.get(0).programUuid);
		assertTrue(rules.get(0).encounterTypeUuids.contains("delivery"));
		assertTrue(rules.get(0).formUuids.contains("third-stage"));
	}

	@Test
	public void isCentral_onlyForCentralRole() {
		assertTrue(ProgramAutoCloseTask.isCentral(" Central "));
		assertFalse(ProgramAutoCloseTask.isCentral("facility"));
		assertFalse(ProgramAutoCloseTask.isCentral(null));
	}
}
