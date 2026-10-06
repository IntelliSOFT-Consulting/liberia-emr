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

import java.util.Date;

/**
 * What the facility's cached remote history is, at the moment it is read (design: chart-open
 * states). The UI shows its age whenever it is not {@link #FRESH}.
 */
public enum HistoryStatus {

	/** Central answered just now, or the cache is within the configured age. */
	FRESH("fresh"),
	/** Older than the configured age, and central answered with an error or is not configured. */
	STALE("stale"),
	/** Central could not be reached; the cached copy is served with its age. */
	OFFLINE("offline"),
	/** Never retrieved, and central answered with an error or is not configured. Retry later. */
	NOT_RETRIEVED("notRetrieved"),
	/** Never retrieved, and central could not be reached. */
	UNAVAILABLE_OFFLINE("unavailableOffline");

	/** How a refresh attempt during this read went. */
	public enum Attempt {
		/** No attempt: the cache was fresh, or no central server is configured. */
		NONE,
		/** Central answered and the cache now holds its answer. */
		OK,
		/** Central answered, but not usefully (an error status or an unreadable body). */
		ERROR,
		/** Central could not be reached (no connection, or it timed out). */
		UNREACHABLE
	}

	private final String code;

	HistoryStatus(String code) {
		this.code = code;
	}

	/** @return the value the API sends */
	public String code() {
		return code;
	}

	/**
	 * @param lastFetched when central last answered for the patient, or null if never; after a
	 *            successful attempt, the time of that attempt
	 * @param now the time of the read
	 * @param maxAgeMs how old the cache may be before it is refreshed
	 * @param attempt how a refresh attempt during this read went
	 */
	public static HistoryStatus of(Date lastFetched, Date now, long maxAgeMs, Attempt attempt) {
		if (attempt == Attempt.OK) {
			return FRESH;
		}
		if (lastFetched != null) {
			if (isFresh(lastFetched, now, maxAgeMs)) {
				return FRESH;
			}
			return attempt == Attempt.UNREACHABLE ? OFFLINE : STALE;
		}
		return attempt == Attempt.UNREACHABLE ? UNAVAILABLE_OFFLINE : NOT_RETRIEVED;
	}

	/** @return whether the cache is young enough to serve without asking central */
	public static boolean isFresh(Date lastFetched, Date now, long maxAgeMs) {
		return lastFetched != null && now.getTime() - lastFetched.getTime() <= maxAgeMs;
	}

	/** @return whether central answered, or null when no attempt was made */
	public static Boolean centralReachable(Attempt attempt) {
		switch (attempt) {
			case OK:
			case ERROR:
				return Boolean.TRUE;
			case UNREACHABLE:
				return Boolean.FALSE;
			default:
				return null;
		}
	}
}
