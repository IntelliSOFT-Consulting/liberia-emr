/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.remotehistory.RemoteHistoryStore;
import org.openmrs.module.liberiaemr.remotehistory.RemoteHistoryStore.CachedSource;
import org.openmrs.module.liberiaemr.web.central.CentralClient;
import org.openmrs.module.liberiaemr.web.remotehistory.HistoryStatus.Attempt;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The facility side of remote patient history (LE-384, ADR 0013): fetches an imported patient's
 * scoped history from central, caches it in tables sync never watches, and serves it from that
 * cache. When central cannot be reached the cache is served with its age, so the chart can say
 * "As of …". Every access, including an empty or failed one, is audited.
 */
@Component("liberiaemr.FacilityHistoryService")
public class FacilityHistoryService {

	/** How old the cache may be, in hours, before a read refreshes it (design: chart open). */
	public static final String GP_MAX_AGE_HOURS = "liberiaemr.remoteHistory.maxAgeHours";

	public static final int DEFAULT_MAX_AGE_HOURS = 24;

	/** A chart-open refresh waits this long for central before serving the cache. */
	static final int READ_REFRESH_TIMEOUT_MS = 5000;

	public static final String REASON_ROUTINE_REFRESH = "routine refresh";

	private static final Logger log = LoggerFactory.getLogger(FacilityHistoryService.class);

	private static final ObjectMapper MAPPER = new ObjectMapper();

	@Autowired
	private RemoteHistoryStore store;

	@Autowired
	private RemoteSearchService remoteSearchService;

	private CentralClient central;

	public FacilityHistoryService() {
	}

	/** For tests: a stand-in central and store. */
	FacilityHistoryService(CentralClient central, RemoteHistoryStore store) {
		this.central = central;
		this.store = store;
	}

	/**
	 * Fetches the patient's history from central and replaces the cache with it. A failure leaves
	 * the cache as it was, so the last good copy is still served, and is retried on the next call.
	 *
	 * @param reason the reason for access the user gave (ADR 0007), or "routine refresh"
	 * @return how the attempt went; {@link Attempt#NONE} when no central server is configured
	 */
	public Attempt refresh(String patientUuid, String reason, int timeoutMs) {
		CentralClient client = central();
		if (!client.isEnabled()) {
			return Attempt.NONE;
		}
		try {
			StringBuilder url = new StringBuilder(client.getCentralUrl()).append("/ws/rest/v1/liberiaemr/remotehistory/")
			        .append(patientUuid);
			String facility = requestingFacility();
			if (facility != null && !facility.isEmpty()) {
				url.append("?requestingFacility=").append(URLEncoder.encode(facility, "UTF-8"));
			}
			JsonNode answer = client.executeGet(url.toString(), timeoutMs);
			Date fetchedAt = now();
			List<CachedSource> sources = new ArrayList<CachedSource>();
			int resources = 0;
			for (JsonNode source : answer.path("sources")) {
				JsonNode bundle = source.path("bundle");
				resources += bundle.path("entry").size();
				String json = MAPPER.writeValueAsString(bundle);
				sources.add(new CachedSource(text(source, "sourceFacilityUuid"), text(source, "sourceFacilityName"), json,
				        sha256(json), fetchedAt));
			}
			store.replaceForPatient(patientUuid, sources);
			store.logFetch(currentUserId(), patientUuid, reason, resources == 0 ? RemoteHistoryStore.EMPTY
			        : RemoteHistoryStore.OK, resources, fetchedAt);
			return Attempt.OK;
		}
		catch (IOException e) {
			log.warn("Central unreachable fetching remote history for {}: {}", patientUuid, e.getMessage());
			store.logFetch(currentUserId(), patientUuid, reason, RemoteHistoryStore.UNREACHABLE, 0, now());
			return Attempt.UNREACHABLE;
		}
		catch (Exception e) {
			log.warn("Central could not serve remote history for " + patientUuid, e);
			store.logFetch(currentUserId(), patientUuid, reason, RemoteHistoryStore.ERROR, 0, now());
			return Attempt.ERROR;
		}
	}

	/**
	 * Audits a shell import whose history is fetched in a separate call, so the access is logged
	 * with its reason even if that call never comes (LE-387).
	 */
	public void logShellImport(String patientUuid, String reason) {
		store.logFetch(currentUserId(), patientUuid, reason, RemoteHistoryStore.SHELL, 0, now());
	}

	/**
	 * Refreshes now, at the user's request: the import's last step and the chart's Refresh. Answers
	 * with what happened and the state of the cache, never the cached records themselves, so it
	 * can be offered to a Records Officer who may import but not view.
	 *
	 * @return {@code {patientUuid, attempt, history, status, facilityCount, fetchedAt}}
	 */
	public ObjectNode refreshNow(String patientUuid, String reason) {
		Attempt attempt = refresh(patientUuid, reason, CentralClient.DEFAULT_TIMEOUT_MS);
		Date lastFetched = store.lastSuccessfulFetch(patientUuid);
		List<CachedSource> cached = store.findByPatient(patientUuid);
		return refreshResponse(patientUuid, attempt,
		    HistoryStatus.of(lastFetched, now(), maxAgeMs(), attempt), lastFetched, cached.size());
	}

	/** Builds the refresh response; separate so its shape is tested on its own. */
	static ObjectNode refreshResponse(String patientUuid, Attempt attempt, HistoryStatus status, Date fetchedAt,
	        int facilityCount) {
		ObjectNode out = MAPPER.createObjectNode();
		out.put("patientUuid", patientUuid);
		out.put("attempt", attempt.name().toLowerCase());
		out.put("history", attempt == Attempt.OK ? "retrieved" : "notRetrieved");
		out.put("status", status.code());
		out.put("facilityCount", facilityCount);
		if (fetchedAt == null) {
			out.putNull("fetchedAt");
		} else {
			out.put("fetchedAt", iso(fetchedAt));
		}
		return out;
	}

	/**
	 * The chart's read: refreshes first when the cache is older than the configured age (or was
	 * never filled) and central is configured, then always answers from the cache.
	 *
	 * @return {@code {patientUuid, status, centralReachable, fetchedAt, ageSeconds, sources}}
	 */
	public ObjectNode read(String patientUuid) {
		Date lastFetched = store.lastSuccessfulFetch(patientUuid);
		Attempt attempt = Attempt.NONE;
		if (!HistoryStatus.isFresh(lastFetched, now(), maxAgeMs()) && central().isEnabled()) {
			attempt = refresh(patientUuid, REASON_ROUTINE_REFRESH, READ_REFRESH_TIMEOUT_MS);
			if (attempt == Attempt.OK) {
				lastFetched = store.lastSuccessfulFetch(patientUuid);
			}
		}
		List<CachedSource> cached = store.findByPatient(patientUuid);
		if (attempt == Attempt.NONE) {
			// Served from the cache alone: still an access, so still audited.
			store.logFetch(currentUserId(), patientUuid, REASON_ROUTINE_REFRESH, RemoteHistoryStore.CACHED,
			    countResources(cached), now());
		}
		Date now = now();
		return response(patientUuid, HistoryStatus.of(lastFetched, now, maxAgeMs(), attempt),
		    HistoryStatus.centralReachable(attempt), lastFetched, now, cached);
	}

	/** Builds the read response; separate so its shape is tested on its own. */
	static ObjectNode response(String patientUuid, HistoryStatus status, Boolean centralReachable, Date fetchedAt,
	        Date now, List<CachedSource> cached) {
		ObjectNode out = MAPPER.createObjectNode();
		out.put("patientUuid", patientUuid);
		out.put("status", status.code());
		if (centralReachable == null) {
			out.putNull("centralReachable");
		} else {
			out.put("centralReachable", centralReachable);
		}
		if (fetchedAt == null) {
			out.putNull("fetchedAt");
			out.putNull("ageSeconds");
		} else {
			out.put("fetchedAt", iso(fetchedAt));
			out.put("ageSeconds", Math.max(0, (now.getTime() - fetchedAt.getTime()) / 1000));
		}
		ArrayNode sources = out.putArray("sources");
		for (CachedSource source : cached) {
			ObjectNode node = sources.addObject();
			node.put("sourceFacilityUuid", source.getSourceFacilityUuid());
			node.put("sourceFacilityName", source.getSourceFacilityName());
			node.put("fetchedAt", iso(source.getFetchedAt()));
			try {
				node.set("bundle", MAPPER.readTree(source.getBundleJson()));
			}
			catch (IOException e) {
				node.putNull("bundle");
			}
		}
		return out;
	}

	// --- seams ------------------------------------------------------------------------------------

	CentralClient central() {
		if (central == null) {
			central = remoteSearchService.getCentral();
		}
		return central;
	}

	protected Date now() {
		return new Date();
	}

	protected long maxAgeMs() {
		String configured = Context.getAdministrationService().getGlobalProperty(GP_MAX_AGE_HOURS, "");
		long hours = DEFAULT_MAX_AGE_HOURS;
		try {
			if (configured != null && !configured.trim().isEmpty()) {
				hours = Math.max(0, Long.parseLong(configured.trim()));
			}
		}
		catch (NumberFormatException e) {
			log.warn("{}='{}' is not a whole number of hours; using {}", GP_MAX_AGE_HOURS, configured,
			    DEFAULT_MAX_AGE_HOURS);
		}
		return hours * 3600L * 1000L;
	}

	/** The facility's own location, sent so central leaves out what this facility already holds. */
	protected String requestingFacility() {
		return Context.getAdministrationService().getGlobalProperty(RemoteSearchService.GP_FACILITY_LOCATION, "");
	}

	protected Integer currentUserId() {
		User user = Context.getAuthenticatedUser();
		return user == null ? null : user.getUserId();
	}

	// --- helpers ----------------------------------------------------------------------------------

	private static int countResources(List<CachedSource> cached) {
		int count = 0;
		for (CachedSource source : cached) {
			try {
				count += MAPPER.readTree(source.getBundleJson()).path("entry").size();
			}
			catch (IOException e) {
				// An unreadable row counts as nothing.
			}
		}
		return count;
	}

	private static String text(JsonNode node, String field) {
		JsonNode value = node.path(field);
		return value.isMissingNode() || value.isNull() ? null : value.asText();
	}

	static String iso(Date date) {
		java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
		format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
		return format.format(date);
	}

	static String sha256(String text) throws Exception {
		byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
		StringBuilder hex = new StringBuilder();
		for (byte b : digest) {
			hex.append(String.format("%02x", b));
		}
		return hex.toString();
	}
}
