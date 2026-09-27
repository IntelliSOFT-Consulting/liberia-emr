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
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Reads the MFL from its DHIS2 API (integration/dhis2/mfl/README.md): a full pull of counties,
 * districts and facilities on every run, paged, GET only. The account goes in a basic auth header
 * to an allowed host only, and redirects are never followed, so it cannot be carried elsewhere.
 */
public class MflClient implements MflSource {

	public static final int PAGE_SIZE = 500;

	private static final Logger log = LoggerFactory.getLogger(MflClient.class);

	private static final int ATTEMPTS = 3;

	private static final int CONNECT_TIMEOUT_MS = 15000;

	private static final int READ_TIMEOUT_MS = 60000;

	private static final String ADMIN_FIELDS = "id,code,name,level,parent[id],closedDate,lastUpdated";

	private static final String FACILITY_FIELDS = ADMIN_FIELDS + ",geometry,organisationUnitGroups[id]";

	/** A request that failed in a way worth retrying, and then worth reporting per page. */
	private static final class PageFailure extends Exception {

		PageFailure(String message) {
			super(message);
		}
	}

	private final String baseUrl;

	private final MflCredentials credentials;

	private final MflEndpointPolicy policy;

	private final int pageSize;

	private final long retryDelayMs;

	/**
	 * @param baseUrl the instance root, without /api (liberiaemr.mfl.url)
	 * @param retryDelayMs the wait before the first retry; it doubles for the next
	 */
	public MflClient(String baseUrl, MflCredentials credentials, MflEndpointPolicy policy, int pageSize,
	    long retryDelayMs) {
		this.baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
		this.credentials = credentials;
		this.policy = policy;
		this.pageSize = pageSize;
		this.retryDelayMs = retryDelayMs;
	}

	@Override
	public MflSnapshot fetch() throws MflException {
		checkUsable();
		List<MflUnit> units = new ArrayList<MflUnit>();
		List<String> failures = new ArrayList<String>();
		pull("counties and districts", "filter=level:ge:2&filter=level:le:3", ADMIN_FIELDS, units, failures);
		pull("facilities", "filter=level:eq:4", FACILITY_FIELDS, units, failures);
		if (units.isEmpty() && !failures.isEmpty()) {
			throw new MflException("Nothing arrived from the MFL: " + failures.get(0));
		}
		return new MflSnapshot(units, failures);
	}

	/**
	 * GET /api/system/info and a count of the facilities, with the configured account.
	 *
	 * @return ok, dhis2Version, facilities, message: a refused or unreachable MFL is an answer
	 */
	public Map<String, Object> testConnection() {
		Map<String, Object> result = new LinkedHashMap<String, Object>();
		result.put("ok", false);
		result.put("dhis2Version", null);
		result.put("facilities", null);
		result.put("message", null);
		try {
			checkUsable();
			JsonNode info = get("system/info", "");
			JsonNode count = get("organisationUnits.json", "filter=level:eq:4&pageSize=1&fields=id");
			result.put("ok", true);
			result.put("dhis2Version", info.path("version").asText(null));
			result.put("facilities", count.path("pager").path("total").asInt());
		}
		catch (MflException e) {
			result.put("message", e.getMessage());
		}
		catch (PageFailure e) {
			result.put("message", "Could not read the MFL: " + e.getMessage());
		}
		return result;
	}

	private void checkUsable() throws MflException {
		try {
			policy.check(baseUrl);
		}
		catch (IllegalArgumentException e) {
			throw new MflException(e.getMessage());
		}
		if (credentials == null || !credentials.isAvailable()) {
			throw new MflException("MFL credentials are not configured on this instance");
		}
	}

	/** Pages through one query; a page that keeps failing is recorded and the rest still come. */
	private void pull(String what, String filter, String fields, List<MflUnit> units, List<String> failures)
	        throws MflException {
		String query = filter + "&fields=" + encode(fields) + "&order=id:asc&pageSize=" + pageSize;
		int pageCount;
		try {
			JsonNode first = getRetrying("organisationUnits.json", query + "&page=1");
			read(first, units);
			pageCount = first.path("pager").path("pageCount").asInt(1);
		}
		catch (PageFailure e) {
			failures.add(what + " page 1: " + e.getMessage());
			return;
		}
		for (int page = 2; page <= pageCount; page++) {
			try {
				read(getRetrying("organisationUnits.json", query + "&page=" + page), units);
			}
			catch (PageFailure e) {
				failures.add(what + " page " + page + ": " + e.getMessage());
			}
		}
	}

	private static void read(JsonNode body, List<MflUnit> units) {
		for (JsonNode node : body.path("organisationUnits")) {
			units.add(MflUnit.fromJson(node));
		}
	}

	private JsonNode getRetrying(String path, String query) throws MflException, PageFailure {
		long delay = retryDelayMs;
		for (int attempt = 1;; attempt++) {
			try {
				return get(path, query);
			}
			catch (PageFailure e) {
				if (attempt >= ATTEMPTS) {
					throw e;
				}
				log.warn("MFL request failed ({}); attempt {} of {}", e.getMessage(), attempt, ATTEMPTS);
				sleep(delay);
				delay *= 2;
			}
		}
	}

	private JsonNode get(String path, String query) throws MflException, PageFailure {
		String url = baseUrl + "/api/" + path + (query.isEmpty() ? "" : "?" + query);
		try {
			policy.check(url);
		}
		catch (IllegalArgumentException e) {
			throw new MflException(e.getMessage());
		}
		HttpURLConnection connection = null;
		try {
			connection = (HttpURLConnection) new URL(url).openConnection();
			connection.setInstanceFollowRedirects(false);
			connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
			connection.setReadTimeout(READ_TIMEOUT_MS);
			connection.setRequestProperty("Accept", "application/json");
			connection.setRequestProperty("Authorization", "Basic " + Base64.getEncoder().encodeToString(
			    (credentials.getUsername() + ":" + credentials.getPassword()).getBytes(StandardCharsets.UTF_8)));
			int status = connection.getResponseCode();
			if (status == 401) {
				throw new MflException("401 Unauthorized from the MFL: check the configured account");
			}
			if (status == 403) {
				throw new MflException("403 Forbidden from the MFL: the account may not read organisation units");
			}
			if (status >= 300 && status < 400) {
				throw new MflException("The MFL answered " + status + " with a redirect, which is not followed: "
				        + "liberiaemr.mfl.url must be the instance root itself");
			}
			if (status != 200) {
				throw new PageFailure("HTTP " + status);
			}
			InputStream in = connection.getInputStream();
			try {
				return MflUnit.JSON.readTree(in);
			}
			finally {
				in.close();
			}
		}
		catch (IOException e) {
			throw new PageFailure(e.getClass().getSimpleName() + ": " + e.getMessage());
		}
		finally {
			if (connection != null) {
				connection.disconnect();
			}
		}
	}

	private static String encode(String value) {
		try {
			return URLEncoder.encode(value, "UTF-8");
		}
		catch (UnsupportedEncodingException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void sleep(long millis) {
		if (millis <= 0) {
			return;
		}
		try {
			Thread.sleep(millis);
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}
