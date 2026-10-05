/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotesearch;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.Patient;
import org.openmrs.PersonName;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService.RemoteSearchException;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService.SearchOutcome;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * Drives the service against a stand-in central server. The OpenMRS Context is replaced by
 * overriding the settings and the local-patient lookup, so no database is needed.
 */
public class RemoteSearchServiceTest {

	private static final String LOCAL_UUID = "11111111-1111-1111-1111-111111111111";

	private static final String NEW_UUID = "22222222-2222-2222-2222-222222222222";

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private HttpServer central;

	private String base;

	private final List<String> methods = new ArrayList<>();

	private final List<String> requests = new ArrayList<>();

	private String authorization;

	private int status;

	private String body;

	private String remoteUrl;

	private final Set<String> localUuids = new HashSet<>();

	private RemoteSearchService service;

	@Before
	public void startCentral() throws Exception {
		status = 200;
		body = "{\"results\":[]}";
		central = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		central.createContext("/", new HttpHandler() {

			@Override
			public void handle(HttpExchange exchange) throws IOException {
				methods.add(exchange.getRequestMethod());
				requests.add(exchange.getRequestURI().toString());
				authorization = exchange.getRequestHeaders().getFirst("Authorization");
				byte[] bytes = body.getBytes("UTF-8");
				exchange.getResponseHeaders().add("Content-Type", "application/json");
				exchange.sendResponseHeaders(status, bytes.length);
				try (OutputStream out = exchange.getResponseBody()) {
					out.write(bytes);
				}
			}
		});
		central.start();
		base = "http://127.0.0.1:" + central.getAddress().getPort();
		remoteUrl = base;
		localUuids.clear();
		localUuids.add(LOCAL_UUID);

		service = new RemoteSearchService() {

			@Override
			protected String getRemoteUrl() {
				return remoteUrl;
			}

			@Override
			protected String getRemoteUser() {
				return "reader";
			}

			@Override
			protected String getRemotePassword() {
				return "pw";
			}

			@Override
			protected boolean existsLocally(String uuid) {
				return localUuids.contains(uuid);
			}
		};
	}

	@After
	public void stopCentral() {
		central.stop(0);
	}

	private static JsonNode json(String text) throws Exception {
		return MAPPER.readTree(text);
	}

	private static String patient(String uuid) {
		return "{\"uuid\":\"" + uuid + "\"}";
	}

	// --- search -----------------------------------------------------------------------------------

	@Test
	public void searchLeavesOutPatientsAlreadyHereAndCountsThem() throws Exception {
		body = "{\"results\":[" + patient(LOCAL_UUID) + "," + patient(NEW_UUID) + "]}";

		SearchOutcome outcome = service.searchPatients("kate");

		assertEquals(1, outcome.getResults().size());
		assertEquals(NEW_UUID, outcome.getResults().get(0).path("uuid").asText());
		assertEquals(1, outcome.getAlreadyLocalCount());
	}

	@Test
	public void searchReportsZeroAlreadyLocalWhenNoneAre() throws Exception {
		body = "{\"results\":[" + patient(NEW_UUID) + "]}";

		SearchOutcome outcome = service.searchPatients("kate");

		assertEquals(1, outcome.getResults().size());
		assertEquals(0, outcome.getAlreadyLocalCount());
	}

	@Test
	public void searchWhereEveryMatchIsLocalIsEmptyButCounted() throws Exception {
		body = "{\"results\":[" + patient(LOCAL_UUID) + "]}";

		SearchOutcome outcome = service.searchPatients("kate");

		assertTrue(outcome.getResults().isEmpty());
		assertEquals(1, outcome.getAlreadyLocalCount());
	}

	@Test
	public void searchWithTooShortAQueryNeverCallsCentral() throws Exception {
		SearchOutcome outcome = service.searchPatients(" k ");

		assertTrue(outcome.getResults().isEmpty());
		assertEquals(0, outcome.getAlreadyLocalCount());
		assertTrue(requests.isEmpty());
	}

	@Test
	public void searchEncodesTheQueryAndSendsBasicAuth() throws Exception {
		service.searchPatients("red kate");

		assertEquals(1, requests.size());
		assertTrue(requests.get(0).contains("q=red+kate"));
		assertEquals("Basic cmVhZGVyOnB3", authorization);
	}

	@Test
	public void searchSaysNotConfiguredWhenThereIsNoCentralUrl() throws Exception {
		remoteUrl = "";
		try {
			service.searchPatients("kate");
			fail("expected RemoteSearchException");
		}
		catch (RemoteSearchException e) {
			assertTrue(e.isNotConfigured());
		}
		assertTrue(requests.isEmpty());
	}

	@Test
	public void searchFailsWhenCentralAnswersWithAnError() throws Exception {
		status = 500;
		try {
			service.searchPatients("kate");
			fail("expected RemoteSearchException");
		}
		catch (RemoteSearchException e) {
			assertFalse(e.isNotConfigured());
		}
	}

	// --- central is only ever read ----------------------------------------------------------------

	@Test
	public void everyCallToCentralIsAGet() throws Exception {
		body = "{\"results\":[" + patient(NEW_UUID) + "]}";

		service.searchPatients("kate");
		service.executeGet(base + "/ws/rest/v1/patient/" + NEW_UUID + "?v=full");

		assertEquals(2, methods.size());
		for (String method : methods) {
			assertEquals("GET", method);
		}
	}

	// --- dates ------------------------------------------------------------------------------------

	@Test
	public void parsesTheDateFormatsOpenmrsReturns() throws Exception {
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");

		assertEquals("2026-08-06", day.format(PatientShellBuilder.parseDate("2026-08-06")));
		assertEquals("2026-08-06", day.format(PatientShellBuilder.parseDate("2026-08-06T00:00:00.000+0000").getTime() > 0
		        ? PatientShellBuilder.parseDate("2026-08-06T12:00:00.000+0000") : null));
	}

	@Test
	public void fullTimestampsKeepTheirInstant() throws Exception {
		SimpleDateFormat utc = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm");
		utc.setTimeZone(TimeZone.getTimeZone("UTC"));

		assertEquals("2026-08-06T10:30", utc.format(PatientShellBuilder.parseDate("2026-08-06T10:30:00.000+0000")));
	}

	// --- is a shared identifier the same person? --------------------------------------------------

	private static Patient localPatient(String gender, int year, String familyName) {
		Patient patient = new Patient();
		patient.setGender(gender);
		patient.setBirthdate(new GregorianCalendar(year, 0, 1).getTime());
		patient.addName(new PersonName("Given", null, familyName));
		return patient;
	}

	private static JsonNode centralPerson(String gender, String birthdate, String familyName) throws Exception {
		return json("{\"gender\":\"" + gender + "\",\"birthdate\":\"" + birthdate
		        + "\",\"names\":[{\"givenName\":\"Other\",\"familyName\":\"" + familyName + "\"}]}");
	}

	@Test
	public void sameGenderBirthdateAndFamilyNameIsTheSamePerson() throws Exception {
		assertTrue(service.samePerson(localPatient("F", 1990, "Doe"),
		    centralPerson("F", "1990-01-01T00:00:00.000+0000", "doe")));
	}

	@Test
	public void aSharedIdentifierAloneDoesNotMakeTwoPatientsTheSame() throws Exception {
		Patient john = localPatient("M", 1984, "Smith");

		// Jane Doe on central, John Smith here, both holding the same OpenMRS ID.
		assertFalse(service.samePerson(john, centralPerson("F", "1990-01-01T00:00:00.000+0000", "Doe")));
	}

	@Test
	public void anyOneDifferingDetailMeansADifferentPerson() throws Exception {
		Patient local = localPatient("F", 1990, "Doe");

		assertFalse(service.samePerson(local, centralPerson("M", "1990-01-01T00:00:00.000+0000", "Doe")));
		assertFalse(service.samePerson(local, centralPerson("F", "1991-01-01T00:00:00.000+0000", "Doe")));
		assertFalse(service.samePerson(local, centralPerson("F", "1990-01-01T00:00:00.000+0000", "Roe")));
	}

	@Test
	public void missingDetailsAreNeverTreatedAsAMatch() throws Exception {
		Patient local = localPatient("F", 1990, "Doe");

		assertFalse(service.samePerson(local, json("{}")));
		assertFalse(service.samePerson(local, json("{\"gender\":\"F\",\"names\":[{\"familyName\":\"Doe\"}]}")));
		assertFalse(service.samePerson(new Patient(), centralPerson("F", "1990-01-01T00:00:00.000+0000", "Doe")));
	}

	// --- credentials only go to the configured central --------------------------------------------

	@Test
	public void refusesToCallAnyUrlOutsideTheConfiguredCentral() throws Exception {
		try {
			service.executeGet("http://127.0.0.1:1/ws/rest/v1/patient");
			fail("expected a refusal");
		}
		catch (IllegalStateException expected) {
			assertTrue(requests.isEmpty());
		}
	}

	@Test
	public void refusesWhenNoCentralIsConfigured() throws Exception {
		remoteUrl = "";
		try {
			service.executeGet(base + "/ws/rest/v1/patient");
			fail("expected a refusal");
		}
		catch (IllegalStateException expected) {
			assertTrue(requests.isEmpty());
		}
	}

	@Test
	public void doesNotFollowARedirect() throws Exception {
		central.removeContext("/");
		central.createContext("/", new HttpHandler() {

			@Override
			public void handle(HttpExchange exchange) throws IOException {
				requests.add(exchange.getRequestURI().toString());
				exchange.getResponseHeaders().add("Location", "http://127.0.0.1:1/elsewhere");
				exchange.sendResponseHeaders(302, -1);
				exchange.close();
			}
		});
		try {
			service.executeGet(base + "/ws/rest/v1/patient/" + NEW_UUID);
			fail("a redirect is not a 200");
		}
		catch (IllegalStateException expected) {
			assertEquals(1, requests.size());
		}
	}

	// --- the password can come from a mounted secret file -----------------------------------------

	private static String secretFile(String content) throws Exception {
		java.io.File file = java.io.File.createTempFile("remote-secret", ".txt");
		file.deleteOnExit();
		java.nio.file.Files.write(file.toPath(), content.getBytes("UTF-8"));
		return file.getPath();
	}

	@Test
	public void aSecretFileIsReadVerbatimApartFromItsTrailingNewline() throws Exception {
		assertEquals("pa ss$word", RemoteSearchService.readSecretFile(secretFile("pa ss$word\n")));
		assertEquals("pa ss$word", RemoteSearchService.readSecretFile(secretFile("pa ss$word\r\n")));
		assertEquals(" spaced ", RemoteSearchService.readSecretFile(secretFile(" spaced ")));
	}

	@Test
	public void anUnreadableSecretFileGivesAnEmptyPasswordNotAFallback() {
		assertEquals("", RemoteSearchService.readSecretFile("/no/such/file"));
	}

	@Test
	public void validatesUuids() {
		assertTrue(service.isValidUuid(" " + NEW_UUID + " "));
		assertFalse(service.isValidUuid("not-a-uuid"));
		assertFalse(service.isValidUuid(null));
		assertEquals(Arrays.asList(true, false), Arrays.asList(service.isValidUuid(LOCAL_UUID), service.isValidUuid("")));
	}
}
