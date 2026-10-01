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

import java.util.Arrays;

import org.junit.Test;

public class AuditLogRedactionTest {

	private static final String GP = "org.openmrs.GlobalProperty";

	@Test
	public void excludesCredentialTypesAndTheirProxies() {
		assertTrue(AuditLogRedaction.isExcludedType("org.openmrs.api.db.LoginCredential"));
		assertTrue(AuditLogRedaction.isExcludedType("org.openmrs.api.db.LoginCredential$HibernateProxy$abc"));
		assertTrue(AuditLogRedaction.isExcludedType("org.openmrs.module.liberiaemr.PasswordResetToken"));
		assertFalse(AuditLogRedaction.isExcludedType("org.openmrs.User"));
		assertFalse(AuditLogRedaction.isExcludedType("org.openmrs.api.db.LoginCredentialHistory"));
		assertFalse(AuditLogRedaction.isExcludedType(null));
	}

	@Test
	public void secretNamesEndInASecretWord() {
		for (String name : Arrays.asList("password", "hashedPassword", "salt", "secretAnswer", "activationKey",
		    "liberiaemr.email.password", "liberiaemr.sms.provider.apiKey", "mfl.api_key", "resetToken", "credentials")) {
			assertTrue(name, AuditLogRedaction.isSecretName(name));
		}
		for (String name : Arrays.asList("security.passwordMinimumLength", "security.passwordCannotMatchUsername",
		    "name", "locale.allowed.list", "tokenizer", "saltLake.district", "propertyValue")) {
			assertFalse(name, AuditLogRedaction.isSecretName(name));
		}
	}

	@Test
	public void aSecretGlobalPropertyKeepsOnlyItsName() {
		String name = "liberiaemr.email.password";
		assertEquals(AuditLogRedaction.REDACTED, AuditLogRedaction.value(GP, name, "propertyValue", "hunter2"));
		assertEquals(AuditLogRedaction.REDACTED, AuditLogRedaction.value(GP, name, "description", "SMTP"));
		assertEquals(name, AuditLogRedaction.value(GP, name, "property", name));
		assertTrue(AuditLogRedaction.isRedacted(GP, name, "propertyValue"));
		assertFalse(AuditLogRedaction.isRedacted(GP, name, "property"));
	}

	@Test
	public void anOrdinaryValuePassesThroughAndNullStaysNull() {
		assertEquals("en, fr", AuditLogRedaction.value(GP, "locale.allowed.list", "propertyValue", "en, fr"));
		assertEquals("Jane", AuditLogRedaction.value("org.openmrs.PersonName", "3", "givenName", "Jane"));
		assertNull(AuditLogRedaction.value(GP, "liberiaemr.email.password", "propertyValue", null));
	}

	@Test
	public void redactsSecretKeysInsideAJsonObjectValue() {
		String value = "{\"lastLoginTimestamp\":\"1727700000000\",\"apiKey\":\"k1\",\"password\":null}";
		String redacted = (String) AuditLogRedaction.value("org.openmrs.User", "5", "userProperties", value);
		assertEquals("{\"lastLoginTimestamp\":\"1727700000000\",\"apiKey\":\"[redacted]\",\"password\":null}", redacted);
		assertEquals("{not json", AuditLogRedaction.redactJsonObject("{not json"));
		// Read back from the stored JSON, a map-valued property is a map, not a string.
		java.util.Map<String, Object> map = new java.util.LinkedHashMap<String, Object>();
		map.put("lastLoginTimestamp", "1727700000000");
		map.put("resetToken", "t1");
		java.util.Map<?, ?> redactedMap = (java.util.Map<?, ?>) AuditLogRedaction.value("org.openmrs.User", "5",
		    "userProperties", map);
		assertEquals("1727700000000", redactedMap.get("lastLoginTimestamp"));
		assertEquals(AuditLogRedaction.REDACTED, redactedMap.get("resetToken"));
		assertEquals("[\"a\"]", AuditLogRedaction.redactJsonObject("[\"a\"]"));
	}
}
