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

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The filters an audit log read accepts, parsed and checked. Every value reaches SQL as a bound
 * parameter; the parsing here only rejects what could never match, with a message the caller can
 * show.
 */
public final class AuditLogQuery {

	public static final List<String> ACTIONS = Collections.unmodifiableList(java.util.Arrays.asList("CREATED",
	    "UPDATED", "DELETED"));

	public static final int DEFAULT_LIMIT = 50;

	public static final int MAX_LIMIT = 200;

	/** A Java class name, or its simple name: letters, digits, dots, $ and _ only. */
	private static final Pattern TYPE = Pattern.compile("^[A-Za-z_$][A-Za-z0-9_$.]{0,510}$");

	private LocalDateTime from;

	private LocalDateTime toExclusive;

	private String user;

	private String type;

	private final Set<String> actions = new LinkedHashSet<String>();

	private boolean topLevelOnly;

	private int startIndex;

	private int limit = DEFAULT_LIMIT;

	public static AuditLogQuery parse(String from, String to, String user, String type, String action,
	        Boolean topLevelOnly, Integer startIndex, Integer limit) {
		AuditLogQuery query = new AuditLogQuery();
		query.from = isBlank(from) ? null : dateTime(from.trim(), "from", false);
		query.toExclusive = isBlank(to) ? null : dateTime(to.trim(), "to", true);
		if (query.from != null && query.toExclusive != null && !query.from.isBefore(query.toExclusive)) {
			throw new IllegalArgumentException("from must be before to");
		}
		query.user = isBlank(user) ? null : user.trim();
		if (!isBlank(type)) {
			String trimmed = type.trim();
			if (!TYPE.matcher(trimmed).matches()) {
				throw new IllegalArgumentException("type must be a Java class name, such as org.openmrs.Location");
			}
			query.type = trimmed;
		}
		if (!isBlank(action)) {
			for (String one : action.split(",")) {
				String value = one.trim().toUpperCase(Locale.ROOT);
				if (value.isEmpty()) {
					continue;
				}
				if (!ACTIONS.contains(value)) {
					throw new IllegalArgumentException("action must be one or more of CREATED, UPDATED, DELETED");
				}
				query.actions.add(value);
			}
		}
		query.topLevelOnly = Boolean.TRUE.equals(topLevelOnly);
		query.startIndex = startIndex == null ? 0 : Math.max(0, startIndex);
		query.limit = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(1, limit), MAX_LIMIT);
		return query;
	}

	/**
	 * A date alone is a whole day: {@code from=2026-09-30} starts at midnight and
	 * {@code to=2026-09-30} runs to the end of that day. A date and time is taken as given, in the
	 * server's time zone, which is also the zone audit rows are stored in.
	 */
	private static LocalDateTime dateTime(String value, String name, boolean endOfDay) {
		try {
			if (value.length() == 10) {
				LocalDate date = LocalDate.parse(value);
				return endOfDay ? date.plusDays(1).atStartOfDay() : date.atStartOfDay();
			}
			return LocalDateTime.parse(value.length() > 19 ? value.substring(0, 19) : value);
		}
		catch (DateTimeParseException e) {
			throw new IllegalArgumentException(name + " must be a date (yyyy-MM-dd) or date and time (yyyy-MM-ddTHH:mm:ss)");
		}
	}

	private static boolean isBlank(String value) {
		return value == null || value.trim().isEmpty();
	}

	public LocalDateTime getFrom() {
		return from;
	}

	public LocalDateTime getToExclusive() {
		return toExclusive;
	}

	public String getUser() {
		return user;
	}

	public String getType() {
		return type;
	}

	/** True when the type filter is a simple name (no package), matched against the end of the class name. */
	public boolean isSimpleType() {
		return type != null && type.indexOf('.') < 0;
	}

	public List<String> getActions() {
		return new ArrayList<String>(actions);
	}

	public boolean isTopLevelOnly() {
		return topLevelOnly;
	}

	public int getStartIndex() {
		return startIndex;
	}

	public int getLimit() {
		return limit;
	}
}
