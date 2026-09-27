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

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The MFL sync's operator settings (ADR 0009 decision 8). They are global properties declared in
 * the module's config.xml and never seeded by Initializer, which would undo an edit on every
 * boot. The credentials and the host allowlist are not among them: they come from the
 * environment only.
 */
public final class MflSettings {

	public static final String GP_ENABLED = "liberiaemr.mfl.enabled";

	public static final String GP_URL = "liberiaemr.mfl.url";

	public static final String GP_SCHEDULE_TIME = "liberiaemr.mfl.schedule.time";

	public static final String DEFAULT_URL = "https://dhis2.moh.gov.lr/mfl";

	public static final String DEFAULT_TIME = "02:00";

	/** The daily run's clock; Liberia keeps GMT all year. */
	public static final ZoneId ZONE = ZoneId.of("Africa/Monrovia");

	private static final Pattern TIME = Pattern.compile("([01][0-9]|2[0-3]):[0-5][0-9]");

	private MflSettings() {
	}

	public static boolean enabled(String configured) {
		return "true".equalsIgnoreCase(configured == null ? null : configured.trim());
	}

	public static String url(String configured) {
		return configured == null || configured.trim().isEmpty() ? DEFAULT_URL : configured.trim();
	}

	/** @return HH:MM, the default when unset or not a valid time */
	public static String time(String configured) {
		return configured != null && TIME.matcher(configured.trim()).matches() ? configured.trim() : DEFAULT_TIME;
	}

	/** @return epoch milliseconds of the next HH:MM in Monrovia strictly after now */
	public static long nextRun(String time, long now) {
		ZonedDateTime current = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(now), ZONE);
		ZonedDateTime next = current.with(LocalTime.parse(time(time))).withSecond(0).withNano(0);
		if (!next.isAfter(current)) {
			next = next.plusDays(1);
		}
		return next.toInstant().toEpochMilli();
	}

	/**
	 * Checks a PUT /config body (docs/architecture/mfl-sync-api.md) before anything is saved.
	 *
	 * @return the global properties to save, by name; omitted fields are absent
	 * @throws IllegalArgumentException with a message fit for the caller
	 */
	public static Map<String, String> validate(Map<String, Object> body, MflEndpointPolicy policy) {
		Map<String, String> properties = new LinkedHashMap<String, String>();
		if (body == null) {
			return properties;
		}
		for (String key : body.keySet()) {
			String lower = key.toLowerCase(Locale.ROOT);
			if ("username".equals(lower) || lower.contains("password") || lower.contains("secret")) {
				throw new IllegalArgumentException(key
				        + " cannot be set here: the MFL credentials come from the deployment environment");
			}
		}
		if (body.containsKey("enabled")) {
			if (!(body.get("enabled") instanceof Boolean)) {
				throw new IllegalArgumentException("enabled must be true or false");
			}
			properties.put(GP_ENABLED, body.get("enabled").toString());
		}
		if (body.containsKey("url")) {
			if (!(body.get("url") instanceof String)) {
				throw new IllegalArgumentException("url must be a string");
			}
			String url = ((String) body.get("url")).trim().replaceAll("/+$", "");
			if (url.toLowerCase(Locale.ROOT).endsWith("/api")) {
				throw new IllegalArgumentException("url is the MFL instance root: leave out /api, the module adds it");
			}
			policy.check(url);
			properties.put(GP_URL, url);
		}
		if (body.containsKey("schedule")) {
			Object schedule = body.get("schedule");
			Object time = schedule instanceof Map ? ((Map<?, ?>) schedule).get("time") : null;
			if (!(time instanceof String) || !TIME.matcher((String) time).matches()) {
				throw new IllegalArgumentException("schedule.time must be HH:MM in 24-hour time");
			}
			properties.put(GP_SCHEDULE_TIME, (String) time);
		}
		return properties;
	}
}
