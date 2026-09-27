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
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

/** What LE-322 adds to the service: availability, status, config, the run lock and the schedule. */
public class MflSyncServiceControlTest extends BaseModuleContextSensitiveTest {

	// Not a real credential.
	private static final String PASSWORD = "stub&secret-value";

	@Autowired
	private MflSyncService service;

	private final List<Runnable> queued = new ArrayList<Runnable>();

	@Before
	public void setUp() {
		MflSchema.apply();
		MflTestMetadata.create(Context.getLocationService());
		service.setSource(new MflSource() {

			@Override
			public MflSnapshot fetch() {
				return new MflSnapshot(MflFixture.units(), Collections.<String> emptyList());
			}
		});
		service.setExecutor(new Executor() {

			@Override
			public void execute(Runnable command) {
				command.run();
			}
		});
		service.setEnvironment(configured());
	}

	@After
	public void tearDown() {
		service.reset();
	}

	private static Map<String, String> configured() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflCredentials.ENV_USERNAME, "api-user");
		env.put(MflCredentials.ENV_PASSWORD, PASSWORD);
		return env;
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> config(Map<String, Object> status) {
		return (Map<String, Object>) status.get("config");
	}

	@Test
	public void getStatus_shouldSayUnavailableWithoutCredentials() {
		service.setEnvironment(new HashMap<String, String>());
		Map<String, Object> status = service.getStatus();
		assertEquals(false, status.get("available"));
		assertNull(config(status).get("username"));
		assertEquals(false, config(status).get("enabled"));
		assertEquals("https://dhis2.moh.gov.lr/mfl", config(status).get("url"));
		assertNull("disabled, so no next run", status.get("nextRun"));
		assertNull(status.get("running"));
		assertNull(status.get("lastRun"));
		assertNull(status.get("lastSuccessfulRun"));
		assertNotNull(status.get("held"));
	}

	@Test
	public void getStatus_shouldShowTheUsernameButNeverThePassword() throws Exception {
		service.startRun(false, null);
		Map<String, Object> status = service.getStatus();
		assertEquals(true, status.get("available"));
		assertEquals("api-user", config(status).get("username"));
		String json = MflUnit.JSON.writeValueAsString(status);
		assertThat(json, not(containsString(PASSWORD)));
		assertThat(json, not(containsString("password")));
	}

	@Test
	public void updateConfig_shouldSaveAndReportTheNewSettings() {
		Map<String, Object> schedule = new LinkedHashMap<String, Object>();
		schedule.put("time", "03:30");
		Map<String, Object> body = new LinkedHashMap<String, Object>();
		body.put("enabled", true);
		body.put("schedule", schedule);
		Map<String, Object> status = service.updateConfig(body);
		assertEquals(true, config(status).get("enabled"));
		assertEquals("03:30", ((Map<?, ?>) config(status).get("schedule")).get("time"));
		assertNotNull("enabled, so there is a next run", status.get("nextRun"));
		assertEquals("true", Context.getAdministrationService().getGlobalProperty(MflSettings.GP_ENABLED));
	}

	@Test
	public void updateConfig_shouldSaveNothingWhenAnyFieldIsInvalid() {
		Map<String, Object> body = new LinkedHashMap<String, Object>();
		body.put("enabled", true);
		body.put("url", "https://mfl.example.org/mfl");
		try {
			service.updateConfig(body);
			fail("expected the url to be refused");
		}
		catch (IllegalArgumentException e) {
			assertThat(e.getMessage(), containsString("not an allowed MFL host"));
		}
		assertFalse(MflSettings.enabled(Context.getAdministrationService().getGlobalProperty(MflSettings.GP_ENABLED)));
	}

	@Test
	public void startRun_shouldReturnTheRunAsItStarted() throws Exception {
		Map<String, Object> run = service.startRun(true, Context.getAuthenticatedUser());
		assertEquals("RUNNING", run.get("status"));
		assertEquals("MANUAL", run.get("trigger"));
		assertEquals("admin", run.get("startedBy"));
		assertEquals(true, run.get("dryRun"));
		Map<String, Object> finished = service.getRun((Integer) run.get("id"));
		assertEquals("SUCCEEDED", finished.get("status"));
	}

	@Test
	public void startRun_shouldRefuseASecondRunWhileOneIsGoing() throws Exception {
		service.setExecutor(new Executor() {

			@Override
			public void execute(Runnable command) {
				queued.add(command);
			}
		});
		Map<String, Object> first = service.startRun(false, null);
		try {
			service.startRun(false, null);
			fail("expected a busy refusal");
		}
		catch (MflSyncService.BusyException e) {
			assertEquals(first.get("id"), e.getRunId());
		}
		assertEquals(first.get("id"), ((Map<?, ?>) service.getStatus().get("running")).get("id"));
		queued.get(0).run();
		assertNull(service.getStatus().get("running"));
		service.startRun(true, null);
	}

	@Test
	public void startRun_shouldRefuseWithoutCredentials() throws Exception {
		service.setEnvironment(new HashMap<String, String>());
		try {
			service.startRun(false, null);
			fail("expected the sync to be unavailable");
		}
		catch (MflSyncService.UnavailableException e) {
			assertEquals("MFL credentials are not configured on this instance", e.getMessage());
		}
	}

	@Test
	public void testConnection_shouldRefuseWithoutCredentials() {
		service.setEnvironment(new HashMap<String, String>());
		try {
			service.testConnection();
			fail("expected the sync to be unavailable");
		}
		catch (MflSyncService.UnavailableException e) {
			assertEquals("MFL credentials are not configured on this instance", e.getMessage());
		}
	}

	@Test
	public void runScheduled_shouldDoNothingWhileDisabled() {
		service.runScheduled();
		assertNull(service.getLastRun());
	}

	@Test
	public void runScheduled_shouldRunAsTheScheduleWhenEnabled() {
		Context.getAdministrationService().setGlobalProperty(MflSettings.GP_ENABLED, "true");
		service.runScheduled();
		Map<String, Object> run = service.getLastRun();
		assertEquals("SCHEDULE", run.get("trigger"));
		assertNull(run.get("startedBy"));
		assertEquals("SUCCEEDED", run.get("status"));
		assertTrue(service.getLastSuccessfulRun() != null);
	}
}
