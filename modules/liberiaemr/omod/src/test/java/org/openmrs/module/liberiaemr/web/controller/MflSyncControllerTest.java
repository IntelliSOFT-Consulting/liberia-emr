/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.controller;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.User;
import org.openmrs.module.liberiaemr.mfl.MflConstants;
import org.openmrs.module.liberiaemr.mfl.MflSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

public class MflSyncControllerTest {

	private final Set<String> privileges = new HashSet<String>();

	private final User user = new User(1);

	private MflSyncService service;

	private MflSyncController controller;

	@Before
	public void setUp() {
		service = mock(MflSyncService.class);
		controller = new MflSyncController() {

			@Override
			protected boolean permitted(String privilege) {
				return privileges.contains(privilege);
			}

			@Override
			protected User currentUser() {
				return user;
			}
		};
		controller.setService(service);
	}

	private void view() {
		privileges.add(MflConstants.PRIVILEGE_VIEW);
	}

	private void manage() {
		privileges.add(MflConstants.PRIVILEGE_MANAGE);
	}

	private static Map<String, Object> map(Object... pairs) {
		if (pairs.length % 2 != 0) {
			throw new IllegalArgumentException("pairs must be key, value, key, value, …");
		}
		Map<String, Object> map = new LinkedHashMap<String, Object>();
		for (int i = 0; i < pairs.length; i += 2) {
			map.put((String) pairs[i], pairs[i + 1]);
		}
		return map;
	}

	@Test
	public void everyEndpoint_shouldAnswer403WithoutItsPrivilege() {
		assertEquals(HttpStatus.FORBIDDEN, controller.status().getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.runs(0, 20).getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.run(1).getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.items(1, null, 0, 50).getStatusCode());
		view();
		assertEquals("View MFL Sync does not allow changes", HttpStatus.FORBIDDEN,
		    controller.updateConfig(map("enabled", true)).getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.testConnection().getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.startRun(map("dryRun", true)).getStatusCode());
		verify(service, never()).startRun(anyBoolean(), any(User.class));
		verify(service, never()).updateConfig(any());
		assertEquals("Manage MFL Sync is required", controller.testConnection().getBody().get("error"));
	}

	@Test
	public void status_shouldReturnTheServiceStatus() {
		view();
		Map<String, Object> status = map("available", true);
		when(service.getStatus()).thenReturn(status);
		ResponseEntity<Map<String, Object>> response = controller.status();
		assertEquals(HttpStatus.OK, response.getStatusCode());
		assertEquals(status, response.getBody());
	}

	@Test
	public void updateConfig_shouldAnswer400WithTheReason() {
		manage();
		when(service.updateConfig(any())).thenThrow(new IllegalArgumentException("url is not allowed"));
		ResponseEntity<Map<String, Object>> response = controller.updateConfig(map("url", "https://x.example"));
		assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
		assertEquals("url is not allowed", response.getBody().get("error"));
	}

	@Test
	public void updateConfig_shouldAnswer200WithTheNewStatus() {
		manage();
		Map<String, Object> status = map("available", false);
		when(service.updateConfig(any())).thenReturn(status);
		assertEquals(status, controller.updateConfig(map("enabled", true)).getBody());
	}

	@Test
	public void testConnection_shouldAnswer503WhenUnavailable() {
		manage();
		when(service.testConnection()).thenThrow(new MflSyncService.UnavailableException());
		ResponseEntity<Map<String, Object>> response = controller.testConnection();
		assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode());
		assertEquals("MFL credentials are not configured on this instance", response.getBody().get("error"));
	}

	@Test
	public void testConnection_shouldAnswer200EvenWhenTheMflSaysNo() {
		manage();
		Map<String, Object> no = map("ok", false, "message", "401 Unauthorized from the MFL: check the configured account");
		when(service.testConnection()).thenReturn(no);
		ResponseEntity<Map<String, Object>> response = controller.testConnection();
		assertEquals(HttpStatus.OK, response.getStatusCode());
		assertEquals(no, response.getBody());
	}

	@Test
	public void startRun_shouldAnswer202WithTheRunAndItsLocation() {
		manage();
		when(service.startRun(true, user)).thenReturn(map("id", 43, "status", "RUNNING"));
		ResponseEntity<Map<String, Object>> response = controller.startRun(map("dryRun", true));
		assertEquals(HttpStatus.ACCEPTED, response.getStatusCode());
		assertEquals("/ws/rest/v1/liberiaemr/mfl/runs/43", response.getHeaders().getFirst("Location"));
		assertEquals(43, response.getBody().get("id"));
	}

	@Test
	public void startRun_shouldDefaultToARealRun() {
		manage();
		when(service.startRun(false, user)).thenReturn(map("id", 44));
		assertEquals(HttpStatus.ACCEPTED, controller.startRun(null).getStatusCode());
		verify(service).startRun(false, user);
	}

	@Test
	public void startRun_shouldAnswer409WithTheRunningRunsId() {
		manage();
		when(service.startRun(false, user)).thenThrow(new MflSyncService.BusyException(43));
		ResponseEntity<Map<String, Object>> response = controller.startRun(map("dryRun", false));
		assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
		assertEquals("A run is already in progress", response.getBody().get("error"));
		assertEquals(43, response.getBody().get("runId"));
	}

	@Test
	public void startRun_shouldAnswer503WhenUnavailable() {
		manage();
		when(service.startRun(false, user)).thenThrow(new MflSyncService.UnavailableException());
		assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.startRun(map()).getStatusCode());
	}

	@Test
	public void startRun_shouldAnswer400ForANonBooleanDryRun() {
		manage();
		assertEquals(HttpStatus.BAD_REQUEST, controller.startRun(map("dryRun", "yes")).getStatusCode());
	}

	@Test
	public void runs_shouldClampPaging() {
		view();
		when(service.getRuns(anyInt(), anyInt())).thenReturn(map("results", Collections.emptyList(), "totalCount", 0));
		controller.runs(-5, 1000);
		verify(service).getRuns(0, 100);
	}

	@Test
	public void run_shouldAnswer404ForAnUnknownRun() {
		view();
		when(service.getRun(42)).thenReturn(null);
		when(service.getItems(eq(42), isNull(), anyInt(), anyInt())).thenReturn(null);
		assertEquals(HttpStatus.NOT_FOUND, controller.run(42).getStatusCode());
		assertEquals(HttpStatus.NOT_FOUND, controller.items(42, null, 0, 50).getStatusCode());
	}

	@Test
	public void items_shouldFilterByAKnownActionAndClampPaging() {
		view();
		when(service.getItems(eq(7), eq("UPDATE"), anyInt(), anyInt())).thenReturn(
		    map("results", Collections.emptyList(), "totalCount", 0));
		assertEquals(HttpStatus.OK, controller.items(7, "UPDATE", 0, 1000).getStatusCode());
		verify(service).getItems(7, "UPDATE", 0, 200);
		assertEquals(HttpStatus.BAD_REQUEST, controller.items(7, "DELETE", 0, 50).getStatusCode());
		when(service.getItems(eq(7), isNull(), anyInt(), anyInt())).thenReturn(
		    map("results", Collections.emptyList(), "totalCount", 0));
		assertEquals(HttpStatus.OK, controller.items(7, null, 0, 50).getStatusCode());
	}
}
