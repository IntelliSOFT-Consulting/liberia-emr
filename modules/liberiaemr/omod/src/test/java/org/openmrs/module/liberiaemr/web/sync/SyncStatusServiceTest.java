/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.List;
import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * Drives the service against a stand-in monitoring server, so the shape it returns is checked
 * against real answers rather than mocks of its own internals.
 */
public class SyncStatusServiceTest {
	
	private HttpServer monitoring;
	
	private SyncStatusService service;
	
	private String base;
	
	@Before
	public void startMonitoring() throws Exception {
		monitoring = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		monitoring.createContext("/api/v1/query", new HttpHandler() {
			
			@Override
			public void handle(HttpExchange exchange) throws IOException {
				String query = URLDecoder.decode(exchange.getRequestURI().getQuery(), "UTF-8");
				respond(exchange, answerFor(query));
			}
		});
		monitoring.createContext("/api/v1/alerts", new HttpHandler() {
			
			@Override
			public void handle(HttpExchange exchange) throws IOException {
				respond(exchange, "{\"data\":{\"alerts\":[" + alert("SyncFacilitySilent", "firing")
				        + "," + alert("ReceiverErrors", "pending") + "]}}");
			}
		});
		monitoring.start();
		base = "http://127.0.0.1:" + monitoring.getAddress().getPort();
		service = new SyncStatusService();
	}
	
	@After
	public void stopMonitoring() {
		monitoring.stop(0);
	}
	
	@Test
	public void readsFacilitiesAndCentralTotals() {
		Map<String, Object> status = service.readStatus(base);
		
		assertEquals(Boolean.TRUE, status.get("enabled"));
		assertEquals(Boolean.TRUE, status.get("available"));
		
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> facilities = (List<Map<String, Object>>) status.get("facilities");
		assertEquals(3, facilities.size());
		// Sorted by code, so the page lists facilities in a stable order.
		assertEquals("barnersville", facilities.get(0).get("code"));
		assertEquals("bong", facilities.get(1).get("code"));
		assertEquals("careysburg", facilities.get(2).get("code"));
		assertEquals(12L, ((Number) facilities.get(2).get("recordsReceived")).longValue());
		assertEquals(5L, ((Number) facilities.get(2).get("receivedLastDay")).longValue());
		// barnersville matches the silent alert. bong has sent nothing today either, but it was
		// enrolled this week, so neither the alert nor the page calls it silent.
		assertEquals(Boolean.TRUE, facilities.get(0).get("silent"));
		assertEquals(Boolean.FALSE, facilities.get(1).get("silent"));
		assertEquals(0L, ((Number) facilities.get(1).get("receivedLastDay")).longValue());
		assertEquals(Boolean.FALSE, facilities.get(2).get("silent"));
		assertEquals(Long.valueOf(1790000000L), facilities.get(2).get("certificateExpires"));
		
		@SuppressWarnings("unchecked")
		Map<String, Object> central = (Map<String, Object>) status.get("central");
		assertEquals(Long.valueOf(3L), central.get("recordsWaiting"));
		assertEquals(Long.valueOf(2L), central.get("recordsRetrying"));
		assertEquals(Long.valueOf(1L), central.get("conflicts"));
		assertEquals(Long.valueOf(0L), central.get("deadLetters"));
		assertEquals(Boolean.TRUE, central.get("receiverUp"));
		assertEquals(Boolean.FALSE, central.get("brokerUp"));
		
		@SuppressWarnings("unchecked")
		List<String> alerts = (List<String>) status.get("alerts");
		assertEquals(1, alerts.size());
		assertEquals("SyncFacilitySilent", alerts.get(0));
	}
	
	@Test
	public void saysSoWhenMonitoringCannotBeReached() {
		// A port with nothing on it: sync may be healthy, so this is "not available", not an error.
		Map<String, Object> status = service.readStatus("http://127.0.0.1:1");
		
		assertEquals(Boolean.TRUE, status.get("enabled"));
		assertEquals(Boolean.FALSE, status.get("available"));
		assertFalse(status.containsKey("facilities"));
	}
	
	@Test
	public void isOffWithoutAMonitoringAddress() {
		Map<String, Object> status = service.readStatus("");
		
		assertEquals(Boolean.FALSE, status.get("enabled"));
		assertTrue(status.size() == 1);
	}
	
	private static String answerFor(String query) {
		if (query.contains("increase(") && query.contains("[24h]")) {
			return samples("address", "sync.facility.careysburg", "5", "sync.facility.barnersville", "0",
			    "sync.facility.bong", "0");
		}
		if (query.contains("present_over_time")) {
			// The silent expression answers with the silent facilities only. bong sent nothing
			// today either, but it was enrolled this week, so Prometheus leaves it out.
			return samples("address", "sync.facility.barnersville", "0");
		}
		if (query.contains("sync_cert_not_after_seconds")) {
			return samples("identity", "careysburg", "1790000000", "barnersville", "1791000000", "bong",
			    "1792000000");
		}
		if (query.contains("DB-SYNC-REC")) {
			return scalar("3");
		}
		if (query.contains("openmrs_dbsync_receiver_errors")) {
			return scalar("2");
		}
		if (query.contains("openmrs_dbsync_receiver_conflicts")) {
			return scalar("1");
		}
		if (query.contains("DLQ")) {
			return scalar("0");
		}
		if (query.contains("sync-receiver")) {
			return scalar("1");
		}
		if (query.contains("job=\"broker\"")) {
			return scalar("0");
		}
		return samples("address", "sync.facility.careysburg", "12", "sync.facility.barnersville", "0",
		    "sync.facility.bong", "4");
	}
	
	/** A Prometheus answer built from label value and sample value pairs. */
	private static String samples(String label, String... pairs) {
		if (pairs.length % 2 != 0) {
			throw new IllegalArgumentException("samples() takes a label value and a sample value per series");
		}
		StringBuilder json = new StringBuilder("{\"data\":{\"result\":[");
		for (int i = 0; i < pairs.length; i += 2) {
			if (i > 0) {
				json.append(",");
			}
			json.append(sample(label, pairs[i], pairs[i + 1]));
		}
		return json.append("]}}").toString();
	}
	
	private static String sample(String label, String value, String number) {
		return "{\"metric\":{\"" + label + "\":\"" + value + "\"},\"value\":[0,\"" + number + "\"]}";
	}
	
	private static String scalar(String number) {
		return "{\"data\":{\"result\":[{\"metric\":{},\"value\":[0,\"" + number + "\"]}]}}";
	}
	
	private static String alert(String name, String state) {
		return "{\"labels\":{\"alertname\":\"" + name + "\"},\"state\":\"" + state + "\"}";
	}
	
	private static void respond(HttpExchange exchange, String body) throws IOException {
		byte[] bytes = body.getBytes("UTF-8");
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(200, bytes.length);
		OutputStream out = exchange.getResponseBody();
		out.write(bytes);
		out.close();
	}
}
