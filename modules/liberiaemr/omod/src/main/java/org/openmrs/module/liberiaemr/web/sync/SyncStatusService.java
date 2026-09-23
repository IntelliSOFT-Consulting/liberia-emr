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

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.openmrs.api.context.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Reads the national sync picture from central's monitoring and returns it as one summary.
 *
 * Central's own sync database cannot answer "how is each facility doing": dbsync records no
 * sender on a queued or failed record, so per-facility facts come from the broker (which
 * authenticates every facility) and from the certificate exporter. Both are already scraped,
 * so this asks monitoring rather than adding a second way to collect the same numbers.
 *
 * Unset address means the feature is off, which is how the facility stacks behave: they run
 * the same image and have no national monitoring to ask.
 */
@Component("liberiaemr.SyncStatusService")
public class SyncStatusService {
	
	private static final Logger log = LoggerFactory.getLogger(SyncStatusService.class);
	
	public static final String ENV_MONITORING_URL = "LIBERIAEMR_SYNC_MONITORING_URL";
	
	public static final String GP_MONITORING_URL = "liberiaemr.sync.monitoringUrl";
	
	/** A page that waits on monitoring is worse than a page that says it cannot reach it. */
	private static final int TIMEOUT_MS = 4000;
	
	private static final String FACILITY_ADDRESS = "artemis_routed_message_count{address=~\"sync\\\\.facility\\\\..+\"}";

	/**
	 * The SyncFacilitySilent expression, word for word (rules-central.yml). The second half is
	 * what keeps a facility enrolled this week, or one whose broker counters were reset by a
	 * restart, out of the answer: three days of nothing only means something once there were
	 * three days to be quiet in.
	 */
	private static final String SILENT_FACILITIES = "increase(" + FACILITY_ADDRESS + "[3d]) == 0"
	        + " and on(address) present_over_time(artemis_routed_message_count[1h] offset 3d)";

	private final ObjectMapper mapper = new ObjectMapper();
	
	/**
	 * @return the summary the sync status page renders; never null, never throws
	 */
	public Map<String, Object> getStatus() {
		return readStatus(monitoringUrl());
	}
	
	/**
	 * The same, against a given monitoring address, so it can be exercised without OpenMRS.
	 *
	 * @param base monitoring address, empty when the feature is off
	 */
	Map<String, Object> readStatus(String base) {
		Map<String, Object> status = new LinkedHashMap<String, Object>();
		if (base == null || base.trim().isEmpty()) {
			status.put("enabled", false);
			return status;
		}
		
		status.put("enabled", true);
		try {
			Map<String, Double> total = instant(base, FACILITY_ADDRESS, "address");
			Map<String, Double> lastDay = instant(base, "increase(" + FACILITY_ADDRESS + "[24h])", "address");
			Map<String, Double> silent = instant(base, SILENT_FACILITIES, "address");
			Map<String, Double> certExpiry = instant(base, "sync_cert_not_after_seconds{kind=\"facility\"}", "identity");
			
			List<Map<String, Object>> facilities = new ArrayList<Map<String, Object>>();
			Map<String, Double> byFacility = new TreeMap<String, Double>();
			for (Map.Entry<String, Double> e : total.entrySet()) {
				byFacility.put(facilityCode(e.getKey()), e.getValue());
			}
			for (Map.Entry<String, Double> e : byFacility.entrySet()) {
				String code = e.getKey();
				Map<String, Object> facility = new LinkedHashMap<String, Object>();
				facility.put("code", code);
				facility.put("recordsReceived", e.getValue().longValue());
				facility.put("receivedLastDay", round(lastDay.get("sync.facility." + code)));
				// The same rule as the alert, so an operator reading the page and an operator
				// reading their mail are told the same thing about the same facility.
				facility.put("silent", silent.containsKey("sync.facility." + code));
				Double notAfter = certExpiry.get(code);
				facility.put("certificateExpires", notAfter == null ? null : Long.valueOf(notAfter.longValue()));
				facilities.add(facility);
			}
			status.put("facilities", facilities);
			
			Map<String, Object> central = new LinkedHashMap<String, Object>();
			central.put("recordsWaiting", scalar(base, "sum(artemis_message_count{queue=\"DB-SYNC-REC.DB-SYNC-RECEIVER\"})"));
			central.put("recordsRetrying", scalar(base, "openmrs_dbsync_receiver_errors"));
			central.put("conflicts", scalar(base, "openmrs_dbsync_receiver_conflicts"));
			central.put("deadLetters", scalar(base, "sum(artemis_message_count{queue=\"DLQ\"})"));
			central.put("receiverUp", scalar(base, "up{job=\"sync-receiver\"}") == 1L);
			central.put("brokerUp", scalar(base, "up{job=\"broker\"}") == 1L);
			status.put("central", central);
			status.put("alerts", firingAlerts(base));
			status.put("available", true);
		}
		catch (Exception e) {
			// The page shows "monitoring unreachable" rather than an error: sync itself may be
			// perfectly healthy, and the reason belongs in this log, not in a browser.
			log.warn("Could not read sync status from monitoring at {}: {}", base, e.toString());
			status.put("available", false);
		}
		return status;
	}
	
	/** Environment first, global property second, and otherwise off. */
	private String monitoringUrl() {
		String value = System.getenv(ENV_MONITORING_URL);
		if (value == null || value.trim().isEmpty()) {
			value = Context.getAdministrationService().getGlobalProperty(GP_MONITORING_URL, "");
		}
		value = value == null ? "" : value.trim();
		while (value.endsWith("/")) {
			value = value.substring(0, value.length() - 1);
		}
		return value;
	}
	
	/** The samples one instant query returns. */
	private JsonNode query(String base, String query) throws Exception {
		return get(base + "/api/v1/query?query=" + URLEncoder.encode(query, "UTF-8")).path("data").path("result");
	}

	/** One instant query, as a map of the given label's value to the sample value. */
	private Map<String, Double> instant(String base, String query, String label) throws Exception {
		Map<String, Double> byLabel = new LinkedHashMap<String, Double>();
		for (JsonNode result : query(base, query)) {
			String key = result.path("metric").path(label).asText("");
			JsonNode value = result.path("value");
			if (!key.isEmpty() && value.size() == 2) {
				byLabel.put(key, Double.valueOf(value.get(1).asText("0")));
			}
		}
		return byLabel;
	}
	
	/**
	 * One number: the first sample of the query, or 0 when the series is absent. Read without
	 * looking at labels, because sum() and up{} do not carry the ones a series does.
	 */
	private long scalar(String base, String query) throws Exception {
		for (JsonNode result : query(base, query)) {
			JsonNode value = result.path("value");
			if (value.size() == 2) {
				return Math.round(Double.parseDouble(value.get(1).asText("0")));
			}
		}
		return 0L;
	}
	
	/**
	 * What central's monitoring reports firing, by name. Every rule it loads today is a sync
	 * rule (rules-central.yml), so the page shows them all rather than guessing at names.
	 */
	private List<String> firingAlerts(String base) throws Exception {
		List<String> names = new ArrayList<String>();
		for (JsonNode alert : get(base + "/api/v1/alerts").path("data").path("alerts")) {
			if ("firing".equals(alert.path("state").asText("")) && !names.contains(alert.path("labels").path("alertname").asText(""))) {
				names.add(alert.path("labels").path("alertname").asText(""));
			}
		}
		return names;
	}
	
	private JsonNode get(String url) throws Exception {
		HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
		connection.setRequestMethod("GET");
		connection.setConnectTimeout(TIMEOUT_MS);
		connection.setReadTimeout(TIMEOUT_MS);
		try {
			if (connection.getResponseCode() != 200) {
				throw new IllegalStateException("monitoring answered " + connection.getResponseCode());
			}
			InputStream body = connection.getInputStream();
			try {
				return mapper.readTree(body);
			}
			finally {
				body.close();
			}
		}
		finally {
			connection.disconnect();
		}
	}
	
	private static String facilityCode(String address) {
		int dot = address.lastIndexOf('.');
		return dot < 0 ? address : address.substring(dot + 1);
	}
	
	private static long round(Double value) {
		return value == null ? 0L : Math.round(value.doubleValue());
	}
}
