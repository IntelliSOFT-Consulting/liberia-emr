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

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The MFL account (ADR 0009 decision 7). It comes from the deployment environment only: there is
 * deliberately no global property fallback, because global properties are readable over REST.
 * The password is never logged, returned or put in a message.
 */
public final class MflCredentials {

	public static final String ENV_USERNAME = "LIBERIAEMR_MFL_USERNAME";

	public static final String ENV_PASSWORD = "LIBERIAEMR_MFL_PASSWORD";

	public static final String ENV_PASSWORD_FILE = "LIBERIAEMR_MFL_PASSWORD_FILE";

	private static final Logger log = LoggerFactory.getLogger(MflCredentials.class);

	private final String username;

	private final String password;

	public MflCredentials(String username, String password) {
		this.username = username == null || username.trim().isEmpty() ? null : username.trim();
		this.password = password == null || password.isEmpty() ? null : password;
	}

	/**
	 * The password file (a path, read verbatim) wins over the plain variable, as for the SMTP relay.
	 */
	public static MflCredentials fromEnvironment(Map<String, String> env) {
		String path = env.get(ENV_PASSWORD_FILE);
		boolean fromFile = path != null && !path.trim().isEmpty();
		return new MflCredentials(env.get(ENV_USERNAME), fromFile ? readSecretFile(path.trim()) : env.get(ENV_PASSWORD));
	}

	public static MflCredentials fromEnvironment() {
		return fromEnvironment(System.getenv());
	}

	/** Only a trailing newline is stripped: `echo secret > file` is how these files get written. */
	static String readSecretFile(String path) {
		try {
			return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8).replaceAll("\\r?\\n$", "");
		}
		catch (IOException e) {
			// Say so loudly, and never log anything read out of the file.
			log.error("{} is set to '{}' but could not be read; the MFL sync is unavailable. Reason: {}", ENV_PASSWORD_FILE,
			    path, e.getMessage());
			return null;
		}
	}

	/** The sync is available on this instance only when both parts are set. */
	public boolean isAvailable() {
		return username != null && password != null;
	}

	/** Shown to administrators so they can tell which account is configured; null when unset. */
	public String getUsername() {
		return username;
	}

	String getPassword() {
		return password;
	}

	@Override
	public String toString() {
		return "MflCredentials[" + username + "]";
	}
}
