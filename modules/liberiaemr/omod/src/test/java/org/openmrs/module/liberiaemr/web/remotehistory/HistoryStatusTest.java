/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Date;

import org.junit.Test;
import org.openmrs.module.liberiaemr.web.remotehistory.HistoryStatus.Attempt;

/** The design's chart-open state table. */
public class HistoryStatusTest {

	private static final long MAX = 24L * 3600L * 1000L;

	private static final Date NOW = new Date();

	private static Date ago(long hours) {
		return new Date(NOW.getTime() - hours * 3600L * 1000L);
	}

	@Test
	public void aSuccessfulRefreshIsFresh() {
		assertEquals(HistoryStatus.FRESH, HistoryStatus.of(null, NOW, MAX, Attempt.OK));
		assertEquals(HistoryStatus.FRESH, HistoryStatus.of(ago(100), NOW, MAX, Attempt.OK));
	}

	@Test
	public void aCacheWithinTheMaxAgeIsFresh() {
		assertEquals(HistoryStatus.FRESH, HistoryStatus.of(ago(23), NOW, MAX, Attempt.NONE));
		assertEquals(HistoryStatus.FRESH, HistoryStatus.of(ago(24), NOW, MAX, Attempt.NONE));
	}

	@Test
	public void anOldCacheIsOfflineWhenCentralIsUnreachable() {
		assertEquals(HistoryStatus.OFFLINE, HistoryStatus.of(ago(25), NOW, MAX, Attempt.UNREACHABLE));
	}

	@Test
	public void anOldCacheIsStaleWhenCentralErrsOrIsNotConfigured() {
		assertEquals(HistoryStatus.STALE, HistoryStatus.of(ago(25), NOW, MAX, Attempt.ERROR));
		assertEquals(HistoryStatus.STALE, HistoryStatus.of(ago(25), NOW, MAX, Attempt.NONE));
	}

	@Test
	public void noCacheIsUnavailableOfflineOrNotRetrieved() {
		assertEquals(HistoryStatus.UNAVAILABLE_OFFLINE, HistoryStatus.of(null, NOW, MAX, Attempt.UNREACHABLE));
		assertEquals(HistoryStatus.NOT_RETRIEVED, HistoryStatus.of(null, NOW, MAX, Attempt.ERROR));
		assertEquals(HistoryStatus.NOT_RETRIEVED, HistoryStatus.of(null, NOW, MAX, Attempt.NONE));
	}

	@Test
	public void reachabilityIsUnknownWithoutAnAttempt() {
		assertEquals(Boolean.TRUE, HistoryStatus.centralReachable(Attempt.OK));
		assertEquals(Boolean.TRUE, HistoryStatus.centralReachable(Attempt.ERROR));
		assertEquals(Boolean.FALSE, HistoryStatus.centralReachable(Attempt.UNREACHABLE));
		assertNull(HistoryStatus.centralReachable(Attempt.NONE));
	}

	@Test
	public void theApiCodesAreCamelCase() {
		assertEquals("unavailableOffline", HistoryStatus.UNAVAILABLE_OFFLINE.code());
		assertEquals("notRetrieved", HistoryStatus.NOT_RETRIEVED.code());
	}
}
