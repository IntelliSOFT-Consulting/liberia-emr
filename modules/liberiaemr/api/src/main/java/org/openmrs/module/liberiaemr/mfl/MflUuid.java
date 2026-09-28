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

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * The UUID a location the sync CREATES gets: UUIDv5 (RFC 4122, SHA-1) of the DHIS2 UID under a
 * fixed namespace (ADR 0009 decision 1). It is never applied to an existing row and nothing matches
 * on it; it only makes central and any facility that runs the sync create the same row.
 */
public final class MflUuid {
	
	/** Fixed forever: changing it would re-key every facility created from now on. */
	public static final UUID NAMESPACE = UUID.fromString("e0b0fbf7-045c-437a-8e7c-4504984c5e1a");
	
	private MflUuid() {
	}
	
	/**
	 * @param uid the DHIS2 UID exactly as the MFL returns it (case-sensitive)
	 * @return the v5 UUID as a lower-case string
	 */
	public static String forUid(String uid) {
		MessageDigest sha1;
		try {
			sha1 = MessageDigest.getInstance("SHA-1");
		}
		catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-1 is required by every JRE", e);
		}
		ByteBuffer namespace = ByteBuffer.allocate(16);
		namespace.putLong(NAMESPACE.getMostSignificantBits());
		namespace.putLong(NAMESPACE.getLeastSignificantBits());
		sha1.update(namespace.array());
		byte[] hash = sha1.digest(uid.getBytes(StandardCharsets.UTF_8));
		hash[6] = (byte) ((hash[6] & 0x0f) | 0x50);
		hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
		ByteBuffer bytes = ByteBuffer.wrap(hash, 0, 16);
		return new UUID(bytes.getLong(), bytes.getLong()).toString();
	}
}
