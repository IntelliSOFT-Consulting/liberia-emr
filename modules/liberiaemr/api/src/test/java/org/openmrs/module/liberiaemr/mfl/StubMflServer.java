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
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * A DHIS2 stand-in on localhost that serves the LE-318 fixture the way the MFL pages it. Tests
 * never reach the MOH's server.
 */
final class StubMflServer implements AutoCloseable {

	private final HttpServer server;

	final List<String> requests = new CopyOnWriteArrayList<String>();

	final List<String> authorizations = new CopyOnWriteArrayList<String>();

	/** Answer this status instead of data for a path+query containing the key, a set number of times. */
	final Map<String, int[]> failures = new ConcurrentHashMap<String, int[]>();

	/** Answer every request with this status (401, 302, …) when set. */
	volatile int status = 0;

	volatile String redirectTo;

	final AtomicInteger hits = new AtomicInteger();

	private final List<JsonNode> units = new ArrayList<JsonNode>();

	StubMflServer() throws IOException {
		for (JsonNode unit : MflFixture.json("organisationUnits.json").get("organisationUnits")) {
			units.add(unit);
		}
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/mfl/api/", new HttpHandler() {

			@Override
			public void handle(HttpExchange exchange) throws IOException {
				serve(exchange);
			}
		});
		server.start();
	}

	/** The instance root, as liberiaemr.mfl.url holds it. */
	String url() {
		return "http://localhost:" + server.getAddress().getPort() + "/mfl";
	}

	/** Drop units from what the server returns, to simulate a unit leaving the MFL. */
	void remove(String uid) {
		for (JsonNode unit : new ArrayList<JsonNode>(units)) {
			if (uid.equals(unit.get("id").asText())) {
				units.remove(unit);
			}
		}
	}

	/** Every space-separated fragment of the key must occur in the request. */
	private static boolean matches(String request, String key) {
		for (String fragment : key.split(" ")) {
			if (!(request + "&").contains(fragment.startsWith("page=") ? "&" + fragment + "&" : fragment)) {
				return false;
			}
		}
		return true;
	}

	void failNext(String fragment, int statusCode, int times) {
		failures.put(fragment, new int[] { statusCode, times });
	}

	private void serve(HttpExchange exchange) throws IOException {
		hits.incrementAndGet();
		String path = exchange.getRequestURI().getPath();
		String query = exchange.getRequestURI().getRawQuery() == null ? "" : exchange.getRequestURI().getRawQuery();
		String decoded = decode(query);
		requests.add(path + "?" + decoded);
		authorizations.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
		if (status == 302) {
			exchange.getResponseHeaders().add("Location", redirectTo);
			respond(exchange, 302, "");
			return;
		}
		if (status != 0) {
			respond(exchange, status, "{\"httpStatus\":\"Unauthorized\",\"httpStatusCode\":" + status + "}");
			return;
		}
		for (Map.Entry<String, int[]> failure : failures.entrySet()) {
			if (matches(path + "?" + decoded, failure.getKey()) && failure.getValue()[1] > 0) {
				failure.getValue()[1]--;
				respond(exchange, failure.getValue()[0], "{}");
				return;
			}
		}
		if (path.endsWith("/system/info")) {
			respond(exchange, 200, "{\"version\":\"2.40.4.1\",\"revision\":\"a1aa81b\"}");
			return;
		}
		if (path.endsWith("/organisationUnits.json")) {
			respond(exchange, 200, page(decoded));
			return;
		}
		respond(exchange, 404, "{}");
	}

	private String page(String query) {
		int min = 1, max = 4, page = 1, pageSize = 50;
		for (String param : query.split("&")) {
			String[] kv = param.split("=", 2);
			if (kv.length < 2) {
				continue;
			}
			if ("filter".equals(kv[0])) {
				String[] f = kv[1].split(":");
				int level = Integer.parseInt(f[2]);
				if ("eq".equals(f[1])) {
					min = level;
					max = level;
				} else if ("ge".equals(f[1])) {
					min = level;
				} else if ("le".equals(f[1])) {
					max = level;
				}
			} else if ("page".equals(kv[0])) {
				page = Integer.parseInt(kv[1]);
			} else if ("pageSize".equals(kv[0])) {
				pageSize = Integer.parseInt(kv[1]);
			}
		}
		List<JsonNode> matching = new ArrayList<JsonNode>();
		for (JsonNode unit : units) {
			int level = unit.get("level").asInt();
			if (level >= min && level <= max) {
				matching.add(unit);
			}
		}
		Collections.sort(matching, (a, b) -> a.get("id").asText().compareTo(b.get("id").asText()));
		int pageCount = Math.max(1, (matching.size() + pageSize - 1) / pageSize);
		ObjectNode body = MflUnit.JSON.createObjectNode();
		ObjectNode pager = body.putObject("pager");
		pager.put("page", page);
		pager.put("pageCount", pageCount);
		pager.put("total", matching.size());
		pager.put("pageSize", pageSize);
		ArrayNode out = body.putArray("organisationUnits");
		for (int i = (page - 1) * pageSize; i < Math.min(matching.size(), page * pageSize); i++) {
			out.add(matching.get(i));
		}
		return body.toString();
	}

	private static String decode(String query) {
		try {
			return URLDecoder.decode(query, "UTF-8");
		}
		catch (UnsupportedEncodingException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void respond(HttpExchange exchange, int code, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(code, bytes.length == 0 ? -1 : bytes.length);
		if (bytes.length > 0) {
			OutputStream out = exchange.getResponseBody();
			out.write(bytes);
			out.close();
		}
		exchange.close();
	}

	@Override
	public void close() {
		server.stop(0);
	}
}
