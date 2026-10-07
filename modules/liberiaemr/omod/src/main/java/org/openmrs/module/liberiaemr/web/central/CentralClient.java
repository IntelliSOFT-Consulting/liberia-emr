/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.central;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Base64;

import org.openmrs.api.context.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The one vetted, read-only connection from a facility to the central server, shared by Remote
 * Search, the patient import and the remote history fetch. Every call is a GET, only to the
 * configured central URL ({@link RemoteEndpointPolicy}: https only, no redirects), with the service
 * account from the deployment environment.
 */
public class CentralClient {
	
	private static final Logger log = LoggerFactory.getLogger(CentralClient.class);
	
	public static final String ENV_REMOTE_URL = "LIBERIAEMR_REMOTE_URL";
	
	public static final String ENV_REMOTE_USER = "LIBERIAEMR_REMOTE_USER";
	
	public static final String ENV_REMOTE_PASSWORD = "LIBERIAEMR_REMOTE_PASSWORD";
	
	/**
	 * A path to a file holding the password, which wins over the plain variable (as for the MFL and
	 * SMTP secrets).
	 */
	public static final String ENV_REMOTE_PASSWORD_FILE = "LIBERIAEMR_REMOTE_PASSWORD_FILE";
	
	/**
	 * Fallback for the URL only, and only for a host on LIBERIAEMR_REMOTE_ALLOWED_HOSTS. The
	 * service account's user name and password come from the environment alone: a global property
	 * is readable and editable over REST, which is no place for a credential.
	 */
	public static final String GP_REMOTE_URL = "liberiaemr.remoteSearch.url";
	
	public static final int DEFAULT_TIMEOUT_MS = 10000;
	
	private final ObjectMapper mapper = new ObjectMapper();
	
	/** @return whether a usable central URL is configured */
	public boolean isEnabled() {
		return !getRemoteUrl().isEmpty();
	}
	
	/** @return the vetted central instance root, or "" when none is usable */
	public String getCentralUrl() {
		return getRemoteUrl();
	}
	
	/** GET with the default timeout. */
	public JsonNode executeGet(String urlStr) throws Exception {
		return executeGet(urlStr, DEFAULT_TIMEOUT_MS);
	}
	
	/**
	 * @param urlStr a URL under the configured central URL
	 * @param timeoutMs connect and read timeout
	 * @return the JSON body of a 200 answer
	 * @throws IllegalStateException for a URL outside central, or any answer but 200
	 */
	public JsonNode executeGet(String urlStr, int timeoutMs) throws Exception {
		// The credentials go only to the vetted central URL, whatever a caller builds.
		String base = getRemoteUrl();
		if (base.isEmpty() || !urlStr.startsWith(base + "/")) {
			throw new IllegalStateException("Refusing to call a URL outside the configured central server");
		}
		HttpURLConnection connection = (HttpURLConnection) new URL(urlStr).openConnection();
		// A redirect could carry the credentials to another host.
		connection.setInstanceFollowRedirects(false);
		connection.setRequestMethod("GET");
		connection.setConnectTimeout(timeoutMs);
		connection.setReadTimeout(timeoutMs);
		connection.setRequestProperty("Accept", "application/json");

		String user = getRemoteUser();
		if (!user.isEmpty()) {
			String auth = user + ":" + getRemotePassword();
			String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes("UTF-8"));
			connection.setRequestProperty("Authorization", "Basic " + encodedAuth);
		}

		try {
			if (connection.getResponseCode() != 200) {
				throw new IllegalStateException("Remote server answered " + connection.getResponseCode());
			}
			try (InputStream body = connection.getInputStream()) {
				return mapper.readTree(body);
			}
		}
		finally {
			connection.disconnect();
		}
	}
	
	/**
	 * @return the central instance root, or "" (feature off) when none is set or the one set breaks
	 *         {@link RemoteEndpointPolicy}: https only, no user info, and a global-property URL
	 *         must name an allowed host
	 */
	protected String getRemoteUrl() {
		String value = System.getenv(ENV_REMOTE_URL);
		boolean fromEnvironment = value != null && !value.trim().isEmpty();
		if (!fromEnvironment) {
			value = Context.getAdministrationService().getGlobalProperty(GP_REMOTE_URL, "");
		}
		value = value == null ? "" : value.trim();
		while (value.endsWith("/")) {
			value = value.substring(0, value.length() - 1);
		}
		if (value.isEmpty()) {
			return "";
		}
		try {
			RemoteEndpointPolicy.fromEnvironment(System.getenv()).check(value, fromEnvironment);
		}
		catch (IllegalArgumentException e) {
			log.error("Remote search is switched off: {}", e.getMessage());
			return "";
		}
		return value;
	}
	
	protected String getRemoteUser() {
		String value = System.getenv(ENV_REMOTE_USER);
		return value == null ? "" : value.trim();
	}
	
	/**
	 * The service account's password. A mounted secret file (LIBERIAEMR_REMOTE_PASSWORD_FILE) wins
	 * over the plain variable, which anyone with host access can read from docker inspect or /proc.
	 * A file that is named but cannot be read gives an empty password, so central refuses the
	 * request, instead of quietly falling back to a different secret.
	 */
	protected String getRemotePassword() {
		String path = System.getenv(ENV_REMOTE_PASSWORD_FILE);
		if (path != null && !path.trim().isEmpty()) {
			return readSecretFile(path.trim());
		}
		String value = System.getenv(ENV_REMOTE_PASSWORD);
		return value == null ? "" : value.trim();
	}
	
	/** Only a trailing newline is stripped: `echo secret > file` is how these files get written. */
	public static String readSecretFile(String path) {
		try {
			return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8).replaceAll("\\r?\\n$", "");
		}
		catch (IOException e) {
			// Never log anything read out of the file.
			log.error("{} is set to '{}' but could not be read; Remote Search cannot sign in. Reason: {}",
			    ENV_REMOTE_PASSWORD_FILE, path, e.getMessage());
			return "";
		}
	}
}
