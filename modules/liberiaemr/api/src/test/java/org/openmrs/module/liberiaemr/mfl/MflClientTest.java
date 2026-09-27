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

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import java.util.Base64;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class MflClientTest {

	// Not a real credential: the stub server accepts anything.
	private static final String USER = "stub-user";

	private static final String PASSWORD = "stub&pass";

	private StubMflServer server;

	@Before
	public void start() throws Exception {
		server = new StubMflServer();
	}

	@After
	public void stop() {
		server.close();
	}

	private MflClient client(int pageSize) {
		return new MflClient(server.url(), new MflCredentials(USER, PASSWORD), localhostPolicy(), pageSize, 0);
	}

	private static MflEndpointPolicy localhostPolicy() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflEndpointPolicy.ENV_ALLOWED_HOSTS, "localhost");
		env.put(MflEndpointPolicy.ENV_ALLOW_INSECURE_HTTP, "true");
		return MflEndpointPolicy.fromEnvironment(env);
	}

	@Test
	public void fetch_shouldReturnEveryUnitAcrossPages() throws Exception {
		MflSnapshot snapshot = client(4).fetch();
		assertTrue(snapshot.isComplete());
		// levels 2 and 3 (2 counties, 6 districts) and 16 facilities; the country is not fetched
		assertEquals(24, snapshot.getUnits().size());
		assertTrue(server.requests.size() > 3);
	}

	@Test
	public void fetch_shouldKeepPointsAndGroupsForFacilities() throws Exception {
		MflSnapshot snapshot = client(500).fetch();
		MflUnit jah = MflFixture.unit(snapshot.getUnits(), "nY6mPgT0Kc6");
		assertEquals("6.814444", jah.getLatitude());
		assertTrue(jah.getGroups().contains(MflConstants.GROUP_CLINIC));
	}

	@Test
	public void fetch_shouldSendBasicAuth() throws Exception {
		client(500).fetch();
		String expected = "Basic "
		        + Base64.getEncoder().encodeToString((USER + ":" + PASSWORD).getBytes(StandardCharsets.UTF_8));
		for (String authorization : server.authorizations) {
			assertEquals(expected, authorization);
		}
	}

	@Test
	public void fetch_shouldRetryAPageThatFailsOnce() throws Exception {
		server.failNext("level:eq:4", 503, 1);
		MflSnapshot snapshot = client(500).fetch();
		assertTrue(snapshot.isComplete());
		assertEquals(24, snapshot.getUnits().size());
	}

	@Test
	public void fetch_shouldReportAPageThatKeepsFailingAsIncomplete() throws Exception {
		server.failNext("level:eq:4 page=2", 500, 10);
		MflSnapshot snapshot = client(4).fetch();
		assertFalse(snapshot.isComplete());
		assertEquals(20, snapshot.getUnits().size());
		assertThat(snapshot.getFailures().get(0), containsString("page 2"));
	}

	@Test
	public void fetch_shouldFailOnRefusedCredentialsWithoutEchoingThem() {
		server.status = 401;
		try {
			client(500).fetch();
			fail("expected an MflException");
		}
		catch (MflException e) {
			assertEquals("401 Unauthorized from the MFL: check the configured account", e.getMessage());
			assertThat(e.getMessage(), not(containsString(PASSWORD)));
		}
	}

	@Test
	public void fetch_shouldNotFollowARedirect() {
		server.status = 302;
		server.redirectTo = "https://elsewhere.example/api/organisationUnits.json";
		try {
			client(500).fetch();
			fail("expected an MflException");
		}
		catch (MflException e) {
			assertThat(e.getMessage(), containsString("redirect"));
			assertEquals(1, server.hits.get());
		}
	}

	@Test
	public void fetch_shouldRefuseAHostThatIsNotAllowedBeforeSendingAnything() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflEndpointPolicy.ENV_ALLOW_INSECURE_HTTP, "true");
		MflClient client = new MflClient(server.url(), new MflCredentials(USER, PASSWORD),
		        MflEndpointPolicy.fromEnvironment(env), 500, 0);
		try {
			client.fetch();
			fail("expected an MflException");
		}
		catch (MflException e) {
			assertThat(e.getMessage(), containsString("not an allowed MFL host"));
			assertEquals(0, server.hits.get());
		}
	}

	@Test
	public void fetch_shouldRefusePlainHttpUnlessAllowedByTheEnvironment() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflEndpointPolicy.ENV_ALLOWED_HOSTS, "localhost");
		MflClient client = new MflClient(server.url(), new MflCredentials(USER, PASSWORD),
		        MflEndpointPolicy.fromEnvironment(env), 500, 0);
		try {
			client.fetch();
			fail("expected an MflException");
		}
		catch (MflException e) {
			assertThat(e.getMessage(), containsString("https://"));
			assertEquals(0, server.hits.get());
		}
	}

	@Test
	public void testConnection_shouldReportTheVersionAndFacilityCount() throws Exception {
		Map<String, Object> result = client(500).testConnection();
		assertEquals(true, result.get("ok"));
		assertEquals("2.40.4.1", result.get("dhis2Version"));
		assertEquals(16, result.get("facilities"));
		assertEquals(null, result.get("message"));
	}

	@Test
	public void testConnection_shouldAnswerNoOnRefusedCredentials() {
		server.status = 401;
		Map<String, Object> result = client(500).testConnection();
		assertEquals(false, result.get("ok"));
		assertEquals("401 Unauthorized from the MFL: check the configured account", result.get("message"));
	}

	@Test
	public void policy_shouldDefaultToTheMohHostOverHttpsOnly() {
		MflEndpointPolicy policy = MflEndpointPolicy.fromEnvironment(new HashMap<String, String>());
		policy.check("https://dhis2.moh.gov.lr/mfl");
		Set<String> rejected = new HashSet<String>();
		for (String url : new String[] { "http://dhis2.moh.gov.lr/mfl", "https://evil.example/mfl",
		        "https://dhis2.moh.gov.lr.evil.example/mfl", "https://user@dhis2.moh.gov.lr/mfl", "ftp://dhis2.moh.gov.lr/",
		        "not a url" }) {
			try {
				policy.check(url);
			}
			catch (IllegalArgumentException e) {
				rejected.add(url);
			}
		}
		assertEquals(6, rejected.size());
	}

	@Test
	public void policy_shouldReadTheAllowlistCaseInsensitively() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflEndpointPolicy.ENV_ALLOWED_HOSTS, " DHIS2.moh.gov.lr , mfl-mirror.moh.gov.lr ");
		MflEndpointPolicy policy = MflEndpointPolicy.fromEnvironment(env);
		policy.check("https://dhis2.moh.gov.lr/mfl");
		policy.check("https://MFL-MIRROR.moh.gov.lr/mfl");
	}
}
