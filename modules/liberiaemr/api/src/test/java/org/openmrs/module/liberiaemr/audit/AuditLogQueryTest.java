/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.audit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.time.LocalDateTime;
import java.util.Arrays;

import org.junit.Test;

public class AuditLogQueryTest {

	private static void rejects(String from, String to, String user, String type, String action) {
		try {
			AuditLogQuery.parse(from, to, user, type, action, null, null, null);
			fail("expected IllegalArgumentException");
		}
		catch (IllegalArgumentException expected) {}
	}

	@Test
	public void defaultsToTheFirstPageOfFifty() {
		AuditLogQuery query = AuditLogQuery.parse(null, " ", "", null, null, null, null, null);
		assertEquals(0, query.getStartIndex());
		assertEquals(50, query.getLimit());
		assertNull(query.getFrom());
		assertNull(query.getUser());
		assertTrue(query.getActions().isEmpty());
		assertFalse(query.isTopLevelOnly());
	}

	@Test
	public void clampsPaging() {
		AuditLogQuery query = AuditLogQuery.parse(null, null, null, null, null, null, -5, 100000);
		assertEquals(0, query.getStartIndex());
		assertEquals(AuditLogQuery.MAX_LIMIT, query.getLimit());
		assertEquals(1, AuditLogQuery.parse(null, null, null, null, null, null, 0, 0).getLimit());
	}

	@Test
	public void aDateAloneIsAWholeDay() {
		AuditLogQuery query = AuditLogQuery.parse("2026-09-01", "2026-09-02", null, null, null, null, null, null);
		assertEquals(LocalDateTime.of(2026, 9, 1, 0, 0), query.getFrom());
		assertEquals(LocalDateTime.of(2026, 9, 3, 0, 0), query.getToExclusive());
	}

	@Test
	public void acceptsADateAndTimeWithOrWithoutFractionOrZone() {
		assertEquals(LocalDateTime.of(2026, 9, 1, 8, 30, 5),
		    AuditLogQuery.parse("2026-09-01T08:30:05", null, null, null, null, null, null, null).getFrom());
		assertEquals(LocalDateTime.of(2026, 9, 1, 8, 30, 5),
		    AuditLogQuery.parse("2026-09-01T08:30:05.123+0000", null, null, null, null, null, null, null).getFrom());
	}

	@Test
	public void rejectsBadDatesAndAnEmptyRange() {
		rejects("yesterday", null, null, null, null);
		rejects(null, "2026-13-01", null, null, null);
		rejects("2026-09-03", "2026-09-02", null, null, null);
	}

	@Test
	public void acceptsActionsInAnyCaseAndRejectsOthers() {
		assertEquals(Arrays.asList("CREATED", "DELETED"),
		    AuditLogQuery.parse(null, null, null, null, "created, Deleted,", null, null, null).getActions());
		rejects(null, null, null, null, "VIEWED");
		rejects(null, null, null, null, "UPDATED;DROP TABLE users");
	}

	@Test
	public void acceptsOnlyClassNamesAsTheType() {
		assertTrue(AuditLogQuery.parse(null, null, null, "Location", null, null, null, null).isSimpleType());
		assertFalse(AuditLogQuery.parse(null, null, null, "org.openmrs.Location", null, null, null, null).isSimpleType());
		rejects(null, null, null, "Location' OR '1'='1", null);
		rejects(null, null, null, "%", null);
	}
}
