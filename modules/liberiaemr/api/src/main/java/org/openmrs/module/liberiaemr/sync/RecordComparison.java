/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.sync;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Compares the facility's version of a record, as dbsync carried it, with central's row field by
 * field. dbsync uses camelCase fields and uuid references; the row uses snake_case columns and ids.
 */
public final class RecordComparison {

	public interface References {

		String uuidOf(String column, Object id);
	}

	private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

	private RecordComparison() {
	}

	/** One entry per field: field, facility, central, compared, differs. {@code central} may be null. */
	public static List<Map<String, Object>> compare(Map<String, Object> facility, Map<String, Object> central,
	        References references) {
		List<Map<String, Object>> fields = new ArrayList<Map<String, Object>>();
		for (Map.Entry<String, Object> entry : facility.entrySet()) {
			String field = entry.getKey();
			boolean reference = field.endsWith("Uuid") && field.length() > 4;
			String facilityValue = reference ? uuidIn(entry.getValue()) : facilityText(entry.getValue());

			String column = null;
			if (central != null) {
				String base = snakeCase(reference ? field.substring(0, field.length() - 4) : field);
				if (central.containsKey(base)) {
					column = base;
				} else if (reference && central.containsKey(base + "_id")) {
					column = base + "_id";
				}
			}

			String centralValue = null;
			if (column != null) {
				Object raw = central.get(column);
				if (raw == null) {
					centralValue = null;
				} else if (reference) {
					centralValue = references.uuidOf(column, raw);
				} else {
					centralValue = centralText(raw, entry.getValue() instanceof Boolean);
				}
			}

			Map<String, Object> line = new LinkedHashMap<String, Object>();
			line.put("field", field);
			line.put("facility", facilityValue);
			line.put("central", centralValue);
			line.put("compared", column != null);
			line.put("differs", column != null && !same(facilityValue, centralValue));
			fields.add(line);
		}
		return fields;
	}

	static String snakeCase(String camel) {
		StringBuilder out = new StringBuilder();
		for (char c : camel.toCharArray()) {
			if (Character.isUpperCase(c)) {
				out.append('_').append(Character.toLowerCase(c));
			} else {
				out.append(c);
			}
		}
		return out.toString();
	}

	/** "UserLight(uuid)" to uuid. */
	static String uuidIn(Object value) {
		if (value == null) {
			return null;
		}
		String text = value.toString();
		int open = text.indexOf('(');
		int close = text.lastIndexOf(')');
		return open >= 0 && close > open ? text.substring(open + 1, close) : text;
	}

	static String facilityText(Object value) {
		if (value == null) {
			return null;
		}
		String text = value.toString();
		if (value instanceof String && text.length() > 19 && text.charAt(10) == 'T') {
			try {
				return ZonedDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
				        .withZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime().truncatedTo(ChronoUnit.SECONDS)
				        .format(DATETIME);
			}
			catch (DateTimeParseException e) {
				return text;
			}
		}
		return text;
	}

	static String centralText(Object value, boolean asBoolean) {
		if (value instanceof java.sql.Timestamp) {
			return ((java.sql.Timestamp) value).toLocalDateTime().truncatedTo(ChronoUnit.SECONDS).format(DATETIME);
		}
		if (value instanceof LocalDateTime) {
			return ((LocalDateTime) value).truncatedTo(ChronoUnit.SECONDS).format(DATETIME);
		}
		if (value instanceof java.sql.Date) {
			return ((java.sql.Date) value).toLocalDate().toString();
		}
		if (value instanceof LocalTime) {
			return ((LocalTime) value).format(DateTimeFormatter.ISO_LOCAL_TIME);
		}
		if (value instanceof LocalDate || value instanceof java.sql.Time) {
			return value.toString();
		}
		if (asBoolean && value instanceof Number) {
			return String.valueOf(((Number) value).intValue() != 0);
		}
		return value.toString();
	}

	private static boolean same(String a, String b) {
		return a == null ? b == null : a.equals(b);
	}
}
