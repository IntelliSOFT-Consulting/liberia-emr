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

import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Keeps credential material out of every audit log response, whatever the auditlog module was
 * configured to record. content-liberia-national's gp-audit.xml already excludes LoginCredential,
 * but that is one global property an administrator can edit; this is the second line.
 * <ul>
 * <li>Rows of a credential-holding type are never returned, listed, counted or exported.</li>
 * <li>A property whose name ends like a secret (password, salt, token, apiKey…) has its values replaced by {@link #REDACTED}.</li>
 * <li>A global property whose name looks like a secret (liberiaemr.email.password, for example)
 * has every value replaced, since its value is the secret.</li>
 * <li>A value that is itself a JSON object, such as a user's properties, has its secret-looking
 * keys replaced too.</li>
 * </ul>
 */
public final class AuditLogRedaction {

	public static final String REDACTED = "[redacted]";

	/**
	 * Types whose rows hold credential material: password hashes and salts, and the single-use
	 * password reset tokens this module issues, which would let a reader reset the user's password.
	 */
	public static final List<String> EXCLUDED_TYPES = Collections.unmodifiableList(Arrays.asList(
	    "org.openmrs.api.db.LoginCredential", "org.openmrs.module.liberiaemr.PasswordResetToken"));

	static final String GLOBAL_PROPERTY = "org.openmrs.GlobalProperty";

	/**
	 * A name ENDING in a secret word, matched on its last dot-separated segment: so
	 * liberiaemr.email.password and apiKey are secrets, while security.passwordMinimumLength, a
	 * password policy an auditor needs to see change, is not.
	 */
	private static final Pattern SECRET = Pattern.compile(
	    "(?i).*(password|passwd|salt|secret|secretanswer|token|api[_-]?key|private[_-]?key|activationkey|credentials?)$");

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private AuditLogRedaction() {
	}

	/** True for a type whose rows are never returned, including its Hibernate proxy subclasses. */
	public static boolean isExcludedType(String type) {
		if (type == null) {
			return false;
		}
		for (String excluded : EXCLUDED_TYPES) {
			if (type.equals(excluded) || type.startsWith(excluded + "$")) {
				return true;
			}
		}
		return false;
	}

	public static boolean isSecretName(String name) {
		if (name == null) {
			return false;
		}
		String last = name.substring(name.lastIndexOf('.') + 1);
		return SECRET.matcher(last).matches();
	}

	/** Every value of this row is a secret: a global property named like one. */
	public static boolean isSecretRow(String type, String identifier) {
		return type != null && type.startsWith(GLOBAL_PROPERTY) && isSecretName(identifier);
	}

	/**
	 * The value to show for one property of one row. The name of a global property ("property")
	 * stays readable so the reader can tell which setting changed.
	 */
	public static Object value(String type, String identifier, String property, Object value) {
		if (value == null) {
			return null;
		}
		if (isSecretName(property)) {
			return REDACTED;
		}
		if (isSecretRow(type, identifier) && !"property".equals(property)) {
			return REDACTED;
		}
		if (value instanceof String) {
			return redactJsonObject((String) value);
		}
		if (value instanceof Map) {
			return redactMap((Map<?, ?>) value);
		}
		return value;
	}

	/**
	 * The module stores a map-valued property (a user's properties, for one) as a JSON object, which
	 * reads back as a map: replace its secret-looking keys' values.
	 */
	static Map<Object, Object> redactMap(Map<?, ?> map) {
		Map<Object, Object> copy = new LinkedHashMap<Object, Object>();
		for (Map.Entry<?, ?> entry : map.entrySet()) {
			boolean secret = entry.getKey() != null && isSecretName(entry.getKey().toString()) && entry.getValue() != null;
			copy.put(entry.getKey(), secret ? REDACTED : entry.getValue());
		}
		return copy;
	}

	/** True when {@link #value} would hide this property of this row. */
	public static boolean isRedacted(String type, String identifier, String property) {
		return isSecretName(property) || (isSecretRow(type, identifier) && !"property".equals(property));
	}

	/**
	 * The same for a JSON object held in a string. Replace the secret-looking keys' values in it; anything else is returned as is.
	 */
	static String redactJsonObject(String value) {
		String trimmed = value.trim();
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
			return value;
		}
		try {
			JsonNode node = MAPPER.readTree(trimmed);
			if (!(node instanceof ObjectNode)) {
				return value;
			}
			boolean changed = false;
			ObjectNode object = (ObjectNode) node;
			for (Iterator<Map.Entry<String, JsonNode>> it = object.fields(); it.hasNext();) {
				Map.Entry<String, JsonNode> field = it.next();
				if (isSecretName(field.getKey()) && !field.getValue().isNull()) {
					field.setValue(object.textNode(REDACTED));
					changed = true;
				}
			}
			return changed ? MAPPER.writeValueAsString(object) : value;
		}
		catch (Exception e) {
			return value;
		}
	}
}
