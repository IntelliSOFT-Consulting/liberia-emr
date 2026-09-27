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

import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class MflSettingsTest {

	private static final MflEndpointPolicy POLICY = MflEndpointPolicy.fromEnvironment(new HashMap<String, String>());

	private static Map<String, Object> body(Object... pairs) {
		if (pairs.length % 2 != 0) {
			throw new IllegalArgumentException("pairs must be key, value, key, value, …");
		}
		Map<String, Object> body = new LinkedHashMap<String, Object>();
		for (int i = 0; i < pairs.length; i += 2) {
			body.put((String) pairs[i], pairs[i + 1]);
		}
		return body;
	}

	private static String rejected(Map<String, Object> body) {
		try {
			MflSettings.validate(body, POLICY);
			fail("expected " + body + " to be rejected");
			return null;
		}
		catch (IllegalArgumentException e) {
			return e.getMessage();
		}
	}

	@Test
	public void validate_shouldTurnAPartialConfigIntoGlobalProperties() {
		Map<String, Object> schedule = body("time", "03:30");
		Map<String, String> gps = MflSettings.validate(
		    body("enabled", true, "url", " https://dhis2.moh.gov.lr/mfl/ ", "schedule", schedule), POLICY);
		assertEquals("true", gps.get(MflSettings.GP_ENABLED));
		assertEquals("https://dhis2.moh.gov.lr/mfl", gps.get(MflSettings.GP_URL));
		assertEquals("03:30", gps.get(MflSettings.GP_SCHEDULE_TIME));
	}

	@Test
	public void validate_shouldLeaveOmittedFieldsOut() {
		Map<String, String> gps = MflSettings.validate(body("enabled", false), POLICY);
		assertEquals(1, gps.size());
		assertEquals("false", gps.get(MflSettings.GP_ENABLED));
	}

	@Test
	public void validate_shouldRefuseAHostOffTheAllowlist() {
		assertThat(rejected(body("url", "https://mfl.example.org/mfl")), containsString("not an allowed MFL host"));
	}

	@Test
	public void validate_shouldRefusePlainHttpAndAnApiSuffix() {
		assertThat(rejected(body("url", "http://dhis2.moh.gov.lr/mfl")), containsString("https://"));
		assertThat(rejected(body("url", "https://dhis2.moh.gov.lr/mfl/api")), containsString("/api"));
	}

	@Test
	public void validate_shouldRefuseCredentialsInTheBody() {
		assertThat(rejected(body("username", "someone")), containsString("username"));
		assertThat(rejected(body("password", "x")), containsString("password"));
		assertThat(rejected(body("passwordFile", "/run/secrets/x")), containsString("passwordFile"));
	}

	@Test
	public void validate_shouldRefuseABadTimeOrType() {
		assertThat(rejected(body("schedule", body("time", "24:00"))), containsString("HH:MM"));
		assertThat(rejected(body("schedule", body("time", "2:00"))), containsString("HH:MM"));
		assertThat(rejected(body("enabled", "yes")), containsString("enabled"));
		assertThat(rejected(body("url", 42)), containsString("url"));
	}

	@Test
	public void time_shouldFallBackToTheDefaultWhenUnsetOrInvalid() {
		assertEquals("02:00", MflSettings.time(null));
		assertEquals("02:00", MflSettings.time("soon"));
		assertEquals("03:30", MflSettings.time("03:30"));
	}

	@Test
	public void enabled_shouldBeOffUnlessTrue() {
		assertFalse(MflSettings.enabled(null));
		assertFalse(MflSettings.enabled("yes"));
		assertTrue(MflSettings.enabled("true"));
	}

	@Test
	public void url_shouldDefaultToTheMohMfl() {
		assertEquals("https://dhis2.moh.gov.lr/mfl", MflSettings.url(null));
		assertEquals("https://dhis2.moh.gov.lr/mfl", MflSettings.url("  "));
	}

	@Test
	public void displayUrl_shouldStripUserInfoFromADirectlyEditedUrl() {
		assertEquals("https://dhis2.moh.gov.lr/mfl", MflSettings.displayUrl("https://user:s3cr&t@dhis2.moh.gov.lr/mfl"));
		assertEquals("https://dhis2.moh.gov.lr:8443/mfl", MflSettings.displayUrl("https://user@dhis2.moh.gov.lr:8443/mfl"));
		assertEquals("https://dhis2.moh.gov.lr/mfl/a@b", MflSettings.displayUrl("https://dhis2.moh.gov.lr/mfl/a@b"));
		assertEquals("https://dhis2.moh.gov.lr/mfl", MflSettings.displayUrl(null));
	}

	@Test
	public void nextRun_shouldBeTodayWhenTheTimeIsStillAheadElseTomorrow() {
		ZoneId monrovia = ZoneId.of("Africa/Monrovia");
		long now = ZonedDateTime.of(2026, 9, 27, 1, 0, 0, 0, monrovia).toInstant().toEpochMilli();
		assertEquals(ZonedDateTime.of(2026, 9, 27, 2, 0, 0, 0, monrovia).toInstant().toEpochMilli(),
		    MflSettings.nextRun("02:00", now));
		long later = ZonedDateTime.of(2026, 9, 27, 2, 0, 0, 0, monrovia).toInstant().toEpochMilli();
		assertEquals(ZonedDateTime.of(2026, 9, 28, 2, 0, 0, 0, monrovia).toInstant().toEpochMilli(),
		    MflSettings.nextRun("02:00", later));
	}
}
