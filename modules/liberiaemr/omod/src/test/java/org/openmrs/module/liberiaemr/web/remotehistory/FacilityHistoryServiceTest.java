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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.module.liberiaemr.remotehistory.RemoteHistoryStore;
import org.openmrs.module.liberiaemr.remotehistory.RemoteHistoryStore.CachedSource;
import org.openmrs.module.liberiaemr.web.central.CentralClient;
import org.openmrs.module.liberiaemr.web.remotehistory.HistoryStatus.Attempt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * The LE-384 behaviour against a stand-in central and an in-memory store: fetch, cache, offline
 * fallback with the cache's age, retry after a failure, and an audit row for every access.
 */
public class FacilityHistoryServiceTest {

	private static final String PATIENT = "11111111-1111-1111-1111-111111111111";

	private static final String FACILITY = "22222222-2222-2222-2222-222222222222";

	private static final long HOUR = 3600L * 1000L;

	private HttpServer central;

	private String base;

	private String remoteUrl;

	private int status;

	private String body;

	private final List<String> requests = new ArrayList<String>();

	private Date now;

	private FakeStore store;

	private FacilityHistoryService service;

	/** The store's behaviour without a database. */
	static class FakeStore extends RemoteHistoryStore {

		final Map<String, List<CachedSource>> rows = new HashMap<String, List<CachedSource>>();

		final List<String[]> fetches = new ArrayList<String[]>();

		final Map<String, Date> lastOk = new HashMap<String, Date>();

		@Override
		public void replaceForPatient(String patientUuid, List<CachedSource> sources) {
			rows.put(patientUuid, new ArrayList<CachedSource>(sources));
		}

		@Override
		public List<CachedSource> findByPatient(String patientUuid) {
			List<CachedSource> found = rows.get(patientUuid);
			return found == null ? new ArrayList<CachedSource>() : found;
		}

		@Override
		public Date lastSuccessfulFetch(String patientUuid) {
			return lastOk.get(patientUuid);
		}

		@Override
		public void logFetch(Integer userId, String patientUuid, String reason, String outcome, int resourceCount,
		        Date when) {
			fetches.add(new String[] { patientUuid, reason, outcome, String.valueOf(resourceCount) });
			if (OK.equals(outcome) || EMPTY.equals(outcome)) {
				lastOk.put(patientUuid, when);
			}
		}

		String lastOutcome() {
			return fetches.get(fetches.size() - 1)[2];
		}
	}

	private static String source(String facility, int resources) {
		StringBuilder entries = new StringBuilder();
		for (int i = 0; i < resources; i++) {
			entries.append(i == 0 ? "" : ",").append("{\"resource\":{\"resourceType\":\"Encounter\",\"id\":\"e")
			        .append(i).append("\"}}");
		}
		return "{\"sourceFacilityUuid\":\"" + facility + "\",\"sourceFacilityName\":\"" + facility
		        + "\",\"bundle\":{\"resourceType\":\"Bundle\",\"type\":\"collection\",\"entry\":[" + entries + "]}}";
	}

	@Before
	public void setUp() throws Exception {
		status = 200;
		body = "{\"patientUuid\":\"" + PATIENT + "\",\"sources\":[" + source("barnersville", 2) + "]}";
		central = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		central.createContext("/", new HttpHandler() {

			@Override
			public void handle(HttpExchange exchange) throws IOException {
				requests.add(exchange.getRequestURI().toString());
				byte[] bytes = body.getBytes("UTF-8");
				exchange.sendResponseHeaders(status, bytes.length);
				try (OutputStream out = exchange.getResponseBody()) {
					out.write(bytes);
				}
			}
		});
		central.start();
		base = "http://127.0.0.1:" + central.getAddress().getPort();
		remoteUrl = base;
		now = new Date();
		store = new FakeStore();

		CentralClient client = new CentralClient() {

			@Override
			protected String getRemoteUrl() {
				return remoteUrl;
			}

			@Override
			protected String getRemoteUser() {
				return "";
			}

			@Override
			protected String getRemotePassword() {
				return "";
			}
		};
		service = new FacilityHistoryService(client, store) {

			@Override
			protected Date now() {
				return now;
			}

			@Override
			protected long maxAgeMs() {
				return 24 * HOUR;
			}

			@Override
			protected String requestingFacility() {
				return FACILITY;
			}

			@Override
			protected Integer currentUserId() {
				return 1;
			}
		};
	}

	@After
	public void stopCentral() {
		central.stop(0);
	}

	/** Points the client at a port with nothing on it. */
	private void centralDown() {
		remoteUrl = "http://127.0.0.1:1";
	}

	private void cacheFetched(long ageMs) {
		List<CachedSource> rows = new ArrayList<CachedSource>();
		Date fetched = new Date(now.getTime() - ageMs);
		rows.add(new CachedSource("careysburg", "Careysburg",
		        "{\"resourceType\":\"Bundle\",\"type\":\"collection\",\"entry\":[{\"resource\":{\"resourceType\":\"Condition\"}}]}",
		        "hash", fetched));
		store.rows.put(PATIENT, rows);
		store.lastOk.put(PATIENT, fetched);
	}

	// --- fetch --------------------------------------------------------------------------------------

	@Test
	public void aFetchCachesEverySourceAndAuditsIt() {
		assertEquals(Attempt.OK, service.refresh(PATIENT, "referral in", 2000));

		assertEquals(1, store.rows.get(PATIENT).size());
		assertEquals("barnersville", store.rows.get(PATIENT).get(0).getSourceFacilityUuid());
		assertEquals(64, store.rows.get(PATIENT).get(0).getContentHash().length());
		assertEquals(1, store.fetches.size());
		assertEquals("referral in", store.fetches.get(0)[1]);
		assertEquals(RemoteHistoryStore.OK, store.fetches.get(0)[2]);
		assertEquals("2", store.fetches.get(0)[3]);
	}

	@Test
	public void theFetchNamesThisFacilitySoCentralLeavesItsOwnRecordsOut() {
		service.refresh(PATIENT, "referral in", 2000);

		assertEquals(1, requests.size());
		assertTrue(requests.get(0).startsWith("/ws/rest/v1/liberiaemr/remotehistory/" + PATIENT));
		assertTrue(requests.get(0).contains("requestingFacility=" + FACILITY));
	}

	@Test
	public void anEmptyAnswerIsAuditedAndCountsAsFetched() {
		body = "{\"patientUuid\":\"" + PATIENT + "\",\"sources\":[]}";

		assertEquals(Attempt.OK, service.refresh(PATIENT, "visiting", 2000));

		assertEquals(RemoteHistoryStore.EMPTY, store.lastOutcome());
		assertTrue(store.rows.get(PATIENT).isEmpty());
		assertEquals(now, store.lastSuccessfulFetch(PATIENT));
	}

	@Test
	public void anUnreachableCentralLeavesTheCacheAsItWas() {
		cacheFetched(48 * HOUR);
		centralDown();

		assertEquals(Attempt.UNREACHABLE, service.refresh(PATIENT, "referral in", 500));

		assertEquals(RemoteHistoryStore.UNREACHABLE, store.lastOutcome());
		assertEquals("careysburg", store.rows.get(PATIENT).get(0).getSourceFacilityUuid());
	}

	@Test
	public void anErrorFromCentralLeavesTheCacheAsItWas() {
		cacheFetched(48 * HOUR);
		status = 500;

		assertEquals(Attempt.ERROR, service.refresh(PATIENT, "referral in", 2000));

		assertEquals(RemoteHistoryStore.ERROR, store.lastOutcome());
		assertEquals("careysburg", store.rows.get(PATIENT).get(0).getSourceFacilityUuid());
	}

	@Test
	public void aFailedFetchIsRetriedOnTheNextCall() {
		centralDown();
		assertEquals(Attempt.UNREACHABLE, service.refresh(PATIENT, "referral in", 500));
		assertFalse(store.rows.containsKey(PATIENT));

		remoteUrl = base;
		assertEquals(Attempt.OK, service.refresh(PATIENT, "referral in", 2000));
		assertEquals(1, store.rows.get(PATIENT).size());
	}

	@Test
	public void withNoCentralConfiguredNothingIsAttempted() {
		remoteUrl = "";

		assertEquals(Attempt.NONE, service.refresh(PATIENT, "referral in", 2000));
		assertTrue(requests.isEmpty());
	}

	// --- read: the chart-open states ----------------------------------------------------------------

	@Test
	public void aFreshCacheIsServedWithoutAskingCentral() {
		cacheFetched(2 * HOUR);

		ObjectNode out = service.read(PATIENT);

		assertTrue(requests.isEmpty());
		assertEquals("fresh", out.path("status").asText());
		assertTrue(out.path("centralReachable").isNull());
		assertEquals(7200, out.path("ageSeconds").asLong());
		assertEquals(1, out.path("sources").size());
		assertEquals(RemoteHistoryStore.CACHED, store.lastOutcome());
	}

	@Test
	public void aStaleCacheIsRefreshedWhenCentralAnswers() {
		cacheFetched(48 * HOUR);

		ObjectNode out = service.read(PATIENT);

		assertEquals("fresh", out.path("status").asText());
		assertTrue(out.path("centralReachable").asBoolean());
		assertEquals(0, out.path("ageSeconds").asLong());
		assertEquals("barnersville", out.path("sources").get(0).path("sourceFacilityUuid").asText());
		assertEquals(FacilityHistoryService.REASON_ROUTINE_REFRESH, store.fetches.get(0)[1]);
	}

	@Test
	public void offlineTheCacheIsServedWithItsAge() {
		cacheFetched(48 * HOUR);
		centralDown();

		ObjectNode out = service.read(PATIENT);

		assertEquals("offline", out.path("status").asText());
		assertFalse(out.path("centralReachable").asBoolean());
		assertEquals(48 * 3600, out.path("ageSeconds").asLong());
		assertEquals(FacilityHistoryService.iso(new Date(now.getTime() - 48 * HOUR)), out.path("fetchedAt").asText());
		JsonNode cached = out.path("sources").get(0);
		assertEquals("careysburg", cached.path("sourceFacilityUuid").asText());
		assertEquals("Bundle", cached.path("bundle").path("resourceType").asText());
	}

	@Test
	public void offlineWithNothingCachedSaysSo() {
		centralDown();

		ObjectNode out = service.read(PATIENT);

		assertEquals("unavailableOffline", out.path("status").asText());
		assertTrue(out.path("fetchedAt").isNull());
		assertEquals(0, out.path("sources").size());
	}

	@Test
	public void neverRetrievedAndCentralErringIsNotRetrieved() {
		status = 500;

		assertEquals("notRetrieved", service.read(PATIENT).path("status").asText());
	}

	@Test
	public void aStaleCacheWithCentralErringIsStale() {
		cacheFetched(48 * HOUR);
		status = 503;

		ObjectNode out = service.read(PATIENT);

		assertEquals("stale", out.path("status").asText());
		assertTrue(out.path("centralReachable").asBoolean());
		assertEquals(1, out.path("sources").size());
	}

	@Test
	public void everyAccessIsAudited() {
		cacheFetched(2 * HOUR);
		service.read(PATIENT); // fresh: CACHED
		now = new Date(now.getTime() + 30 * HOUR);
		service.read(PATIENT); // stale: refreshed, OK
		centralDown();
		now = new Date(now.getTime() + 30 * HOUR);
		service.read(PATIENT); // stale, offline: UNREACHABLE

		assertEquals(3, store.fetches.size());
		assertEquals(RemoteHistoryStore.CACHED, store.fetches.get(0)[2]);
		assertEquals(RemoteHistoryStore.OK, store.fetches.get(1)[2]);
		assertEquals(RemoteHistoryStore.UNREACHABLE, store.fetches.get(2)[2]);
	}

	// --- import in steps (LE-387) -----------------------------------------------------------------

	@Test
	public void aShellImportIsAuditedWithItsReasonAndDoesNotCountAsFetched() {
		service.logShellImport(PATIENT, "Referral in");

		assertEquals(1, store.fetches.size());
		assertEquals("Referral in", store.fetches.get(0)[1]);
		assertEquals(RemoteHistoryStore.SHELL, store.lastOutcome());
		assertEquals(null, store.lastSuccessfulFetch(PATIENT));
		assertTrue(requests.isEmpty());
	}

	@Test
	public void refreshNowSaysRetrievedAndCountsTheFacilities() {
		body = "{\"patientUuid\":\"" + PATIENT + "\",\"sources\":[" + source("barnersville", 2) + ","
		        + source("careysburg", 1) + "]}";

		ObjectNode out = service.refreshNow(PATIENT, "Visiting patient");

		assertEquals("ok", out.path("attempt").asText());
		assertEquals("retrieved", out.path("history").asText());
		assertEquals("fresh", out.path("status").asText());
		assertEquals(2, out.path("facilityCount").asInt());
		assertEquals(FacilityHistoryService.iso(now), out.path("fetchedAt").asText());
		assertEquals("Visiting patient", store.fetches.get(0)[1]);
		// Only the outcome, never the records: a Records Officer can run it without View Remote History.
		assertTrue(out.path("sources").isMissingNode());
	}

	@Test
	public void refreshNowWithNothingAtCentralIsRetrievedWithNoFacilities() {
		body = "{\"patientUuid\":\"" + PATIENT + "\",\"sources\":[]}";

		ObjectNode out = service.refreshNow(PATIENT, "Emergency");

		assertEquals("retrieved", out.path("history").asText());
		assertEquals(0, out.path("facilityCount").asInt());
		assertEquals(RemoteHistoryStore.EMPTY, store.lastOutcome());
	}

	@Test
	public void refreshNowOfflineKeepsTheCacheAndSaysNotRetrieved() {
		cacheFetched(30 * HOUR);
		centralDown();

		ObjectNode out = service.refreshNow(PATIENT, "routine refresh");

		assertEquals("unreachable", out.path("attempt").asText());
		assertEquals("notRetrieved", out.path("history").asText());
		assertEquals("offline", out.path("status").asText());
		assertEquals(1, out.path("facilityCount").asInt());
		assertEquals(FacilityHistoryService.iso(new Date(now.getTime() - 30 * HOUR)), out.path("fetchedAt").asText());
	}

	@Test
	public void refreshNowWhenNeverRetrievedAndCentralErrsIsNotRetrieved() {
		status = 500;

		ObjectNode out = service.refreshNow(PATIENT, "Visiting patient");

		assertEquals("error", out.path("attempt").asText());
		assertEquals("notRetrieved", out.path("history").asText());
		assertEquals("notRetrieved", out.path("status").asText());
		assertEquals(0, out.path("facilityCount").asInt());
		assertTrue(out.path("fetchedAt").isNull());
	}

	@Test
	public void theContentHashIsSha256() throws Exception {
		assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		    FacilityHistoryService.sha256(""));
	}
}
