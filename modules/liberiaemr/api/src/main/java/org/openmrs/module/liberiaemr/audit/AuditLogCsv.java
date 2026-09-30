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

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The audit log export's CSV (RFC 4180): one line per row, the recorded values flattened into one
 * readable column. A cell that a spreadsheet would run as a formula is prefixed with a quote, since
 * recorded values are typed by users.
 */
public final class AuditLogCsv {

	static final String[] COLUMNS = { "date", "action", "type", "identifier", "username", "user_uuid", "uuid",
	        "parent_uuid", "values" };

	private AuditLogCsv() {
	}

	public static String header() {
		return line(COLUMNS);
	}

	@SuppressWarnings("unchecked")
	public static String row(Map<String, Object> row) {
		Map<String, Object> user = (Map<String, Object>) row.get("user");
		return line(new String[] { text(row.get("dateCreated")), text(row.get("action")), text(row.get("type")),
		        text(row.get("identifier")), user == null ? "" : login(user),
		        user == null ? "" : text(user.get("uuid")), text(row.get("uuid")), text(row.get("parentUuid")),
		        values(row) });
	}

	/** "property: previous -> current" for each change, or "property = value" for a deleted item's last state. */
	@SuppressWarnings("unchecked")
	static String values(Map<String, Object> row) {
		List<String> parts = new ArrayList<String>();
		Object changes = row.get("changes");
		if (changes instanceof List) {
			for (Map<String, Object> change : (List<Map<String, Object>>) changes) {
				parts.add(change.get("property") + ": " + text(change.get("previous")) + " -> "
				        + text(change.get("current")));
			}
		}
		Object state = row.get("lastState");
		if (state instanceof List) {
			for (Map<String, Object> property : (List<Map<String, Object>>) state) {
				parts.add(property.get("property") + " = " + text(property.get("value")));
			}
		}
		return String.join(" | ", parts);
	}

	/** The username, or the system ID of an account that has none (the demo admin, for one). */
	static String login(Map<String, Object> user) {
		String username = text(user.get("username"));
		return username.isEmpty() ? text(user.get("systemId")) : username;
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString();
	}

	static String line(String[] cells) {
		StringBuilder line = new StringBuilder();
		for (int i = 0; i < cells.length; i++) {
			if (i > 0) {
				line.append(',');
			}
			line.append(cell(cells[i]));
		}
		return line.append("\r\n").toString();
	}

	static String cell(String value) {
		if (value == null || value.isEmpty()) {
			return "";
		}
		String safe = value;
		char first = safe.charAt(0);
		if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
			safe = "'" + safe;
		}
		if (safe.indexOf(',') >= 0 || safe.indexOf('"') >= 0 || safe.indexOf('\n') >= 0 || safe.indexOf('\r') >= 0
		        || !safe.equals(value)) {
			return '"' + safe.replace("\"", "\"\"") + '"';
		}
		return safe;
	}
}
