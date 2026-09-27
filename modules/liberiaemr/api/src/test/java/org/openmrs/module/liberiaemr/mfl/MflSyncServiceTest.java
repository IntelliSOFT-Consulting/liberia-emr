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
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.beans.factory.annotation.Autowired;

public class MflSyncServiceTest extends BaseModuleContextSensitiveTest {

	@Autowired
	private MflSyncService service;

	@Before
	public void schema() {
		MflSchema.apply();
		MflTestMetadata.create(Context.getLocationService());
	}

	private static MflSource fixture() {
		return new MflSource() {

			@Override
			public MflSnapshot fetch() {
				return new MflSnapshot(MflFixture.units(), Collections.<String> emptyList());
			}
		};
	}

	private static MflSource refusing() {
		return new MflSource() {

			@Override
			public MflSnapshot fetch() throws MflException {
				throw new MflException("401 Unauthorized from the MFL: check the configured account");
			}
		};
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> counts(Map<String, Object> run) {
		return (Map<String, Object>) run.get("counts");
	}

	@Test
	public void runNow_shouldRecordASucceededRunWithItsCountsAndItems() {
		int id = service.runNow(fixture(), false, MflSyncService.TRIGGER_MANUAL, Context.getAuthenticatedUser());
		Map<String, Object> run = service.getRun(id);
		assertEquals(id, run.get("id"));
		assertEquals("SUCCEEDED", run.get("status"));
		assertEquals(false, run.get("dryRun"));
		assertEquals("MANUAL", run.get("trigger"));
		assertEquals("admin", run.get("startedBy"));
		assertNotNull(run.get("started"));
		assertNotNull(run.get("finished"));
		assertEquals(23, counts(run).get("created"));
		assertNull(run.get("message"));

		Map<String, Object> page = service.getItems(id, "CREATE", 0, 50);
		assertEquals(23, page.get("totalCount"));
		Map<String, Object> jah = null;
		for (Map<String, Object> item : (List<Map<String, Object>>) page.get("results")) {
			if ("nY6mPgT0Kc6".equals(item.get("mflUid"))) {
				jah = item;
			}
		}
		assertEquals("FACILITY", jah.get("level"));
		assertEquals("LBR-06-0624-06", jah.get("mflCode"));
		assertEquals(MflUuid.forUid("nY6mPgT0Kc6"), jah.get("locationUuid"));
		assertEquals("Jah Clinic", jah.get("name"));
		List<Map<String, Object>> changes = (List<Map<String, Object>>) jah.get("changes");
		assertEquals("name", changes.get(0).get("field"));
		assertNull(changes.get(0).get("from"));
		assertEquals("Jah Clinic", changes.get(0).get("to"));
	}

	@Test
	public void runNow_shouldRecordAFailedRunWhenTheMflRefusesTheAccount() {
		int id = service.runNow(refusing(), false, MflSyncService.TRIGGER_SCHEDULE, null);
		Map<String, Object> run = service.getRun(id);
		assertEquals("FAILED", run.get("status"));
		assertEquals("401 Unauthorized from the MFL: check the configured account", run.get("message"));
		assertNull(run.get("startedBy"));
		assertEquals("SCHEDULE", run.get("trigger"));
	}

	@Test
	public void runNow_shouldEndPartialWhenRetirementIsSkipped() {
		service.runNow(fixture(), false, MflSyncService.TRIGGER_MANUAL, null);
		int id = service.runNow(new MflSource() {

			@Override
			public MflSnapshot fetch() {
				return new MflSnapshot(MflFixture.units(), Collections.singletonList("facilities page 2: HTTP 500"));
			}
		}, false, MflSyncService.TRIGGER_MANUAL, null);
		Map<String, Object> run = service.getRun(id);
		assertEquals("PARTIAL", run.get("status"));
		assertThat((String) run.get("message"), containsString("facilities page 2"));
	}

	@Test
	public void runNow_shouldRecordADryRunsCountsWithoutWriting() {
		int id = service.runNow(fixture(), true, MflSyncService.TRIGGER_MANUAL, null);
		Map<String, Object> run = service.getRun(id);
		assertEquals(true, run.get("dryRun"));
		assertEquals(23, counts(run).get("created"));
		assertNull(Context.getLocationService().getLocationByUuid(MflUuid.forUid("nY6mPgT0Kc6")));
	}

	@Test
	public void getRuns_shouldListNewestFirstWithATotal() {
		int first = service.runNow(fixture(), true, MflSyncService.TRIGGER_MANUAL, null);
		int second = service.runNow(fixture(), true, MflSyncService.TRIGGER_MANUAL, null);
		Map<String, Object> page = service.getRuns(0, 20);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> results = (List<Map<String, Object>>) page.get("results");
		assertEquals(2, page.get("totalCount"));
		assertEquals(second, results.get(0).get("id"));
		assertEquals(first, results.get(1).get("id"));
		assertEquals(1, ((List<?>) service.getRuns(1, 20).get("results")).size());
	}

	@Test
	public void lastRuns_shouldTellTheLastFromTheLastSuccessful() {
		int ok = service.runNow(fixture(), false, MflSyncService.TRIGGER_MANUAL, null);
		int failed = service.runNow(refusing(), false, MflSyncService.TRIGGER_MANUAL, null);
		assertEquals(failed, service.getLastRun().get("id"));
		assertEquals(ok, service.getLastSuccessfulRun().get("id"));
	}

	@Test
	public void getRun_shouldReturnNullForAnUnknownRun() {
		assertNull(service.getRun(424242));
		assertNull(service.getItems(424242, null, 0, 50));
	}

	@Test
	public void getHeld_shouldCountTheMflLocationsHereByLevel() {
		service.runNow(fixture(), false, MflSyncService.TRIGGER_MANUAL, null);
		Context.flushSession();
		Map<String, Object> held = service.getHeld();
		assertEquals(2, held.get("counties"));
		assertEquals(5, held.get("districts"));
		assertEquals(15, held.get("facilities"));
		assertEquals(1, held.get("retired"));
	}
}
