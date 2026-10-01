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

import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.Writer;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.openmrs.module.liberiaemr.audit.AuditLogQuery;
import org.openmrs.module.liberiaemr.audit.AuditLogStore;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;

public class AuditLogControllerTest {

	private boolean permitted;

	private AuditLogStore store;

	private AuditLogController controller;

	@Before
	public void setUp() {
		permitted = true;
		store = mock(AuditLogStore.class);
		controller = new AuditLogController() {

			@Override
			protected boolean permitted() {
				return permitted;
			}

			@Override
			protected String currentUsername() {
				return "ict";
			}
		};
		controller.setStore(store);
	}

	private ResponseEntity<Map<String, Object>> list(String from, String to, String user, String type, String action) {
		return controller.list(from, to, user, type, action, null, null, null);
	}

	// --- authorisation ----------------------------------------------------------------------------

	@Test
	public void everyCallNeedsGetAuditLogs() throws Exception {
		permitted = false;
		assertEquals(HttpStatus.FORBIDDEN, list(null, null, null, null, null).getStatusCode());
		assertEquals("Get Audit Logs is required", list(null, null, null, null, null).getBody().get("error"));
		assertEquals(HttpStatus.FORBIDDEN, controller.get("x").getStatusCode());
		assertEquals(HttpStatus.FORBIDDEN, controller.types().getStatusCode());
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.export(null, null, null, null, null, null, null, response);
		assertEquals(403, response.getStatus());
		assertThat(response.getContentAsString(), containsString("Get Audit Logs is required"));
		verifyNoInteractions(store);
	}

	@Test
	public void refusesBeforeValidating() {
		permitted = false;
		assertEquals(HttpStatus.FORBIDDEN, list("not a date", null, null, null, null).getStatusCode());
	}

	// --- the auditlog module is absent ------------------------------------------------------------

	@Test
	public void answers503WithoutTheAuditlogModule() throws Exception {
		AuditLogStore.UnavailableException absent = new AuditLogStore.UnavailableException("not installed");
		when(store.list(any(AuditLogQuery.class))).thenThrow(absent);
		when(store.get("x")).thenThrow(absent);
		when(store.types()).thenThrow(absent);
		when(store.count(any(AuditLogQuery.class))).thenThrow(absent);

		assertEquals(HttpStatus.SERVICE_UNAVAILABLE, list(null, null, null, null, null).getStatusCode());
		assertEquals("not installed", list(null, null, null, null, null).getBody().get("error"));
		assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.get("x").getStatusCode());
		assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.types().getStatusCode());
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.export(null, null, null, null, null, null, null, response);
		assertEquals(503, response.getStatus());
		assertThat(response.getContentAsString(), containsString("not installed"));
	}

	// --- list, filters and paging -----------------------------------------------------------------

	@Test
	public void passesFiltersAndPagingToTheStore() {
		Map<String, Object> page = Collections.<String, Object> singletonMap("totalCount", 0L);
		when(store.list(any(AuditLogQuery.class))).thenReturn(page);

		ResponseEntity<Map<String, Object>> response = controller.list("2026-09-01", "2026-09-30", "ict", "Location",
		    "UPDATED,DELETED", true, 100, 25);
		assertEquals(HttpStatus.OK, response.getStatusCode());
		assertSame(page, response.getBody());

		ArgumentCaptor<AuditLogQuery> captor = ArgumentCaptor.forClass(AuditLogQuery.class);
		verify(store).list(captor.capture());
		AuditLogQuery query = captor.getValue();
		assertEquals("ict", query.getUser());
		assertEquals("Location", query.getType());
		assertEquals(2, query.getActions().size());
		assertEquals(true, query.isTopLevelOnly());
		assertEquals(100, query.getStartIndex());
		assertEquals(25, query.getLimit());
		assertEquals(java.time.LocalDateTime.of(2026, 10, 1, 0, 0), query.getToExclusive());
	}

	@Test
	public void rejectsBadFiltersWith400() {
		assertEquals(HttpStatus.BAD_REQUEST, list("yesterday", null, null, null, null).getStatusCode());
		assertEquals(HttpStatus.BAD_REQUEST, list(null, null, null, "x'--", null).getStatusCode());
		ResponseEntity<Map<String, Object>> action = list(null, null, null, null, "VIEWED");
		assertEquals(HttpStatus.BAD_REQUEST, action.getStatusCode());
		assertThat((String) action.getBody().get("error"), containsString("CREATED, UPDATED, DELETED"));
		verifyNoInteractions(store);
	}

	// --- detail -----------------------------------------------------------------------------------

	@Test
	public void returnsOneRowOr404() {
		Map<String, Object> row = new LinkedHashMap<String, Object>();
		row.put("uuid", "r-1");
		when(store.get("r-1")).thenReturn(row);
		when(store.get("r-2")).thenReturn(null);
		assertEquals(HttpStatus.OK, controller.get("r-1").getStatusCode());
		assertSame(row, controller.get("r-1").getBody());
		assertEquals(HttpStatus.NOT_FOUND, controller.get("r-2").getStatusCode());
	}

	@Test
	public void listsTypes() {
		when(store.types()).thenReturn(Collections.<Map<String, Object>> emptyList());
		ResponseEntity<Map<String, Object>> response = controller.types();
		assertEquals(HttpStatus.OK, response.getStatusCode());
		assertEquals(Collections.emptyList(), response.getBody().get("results"));
	}

	// --- CSV --------------------------------------------------------------------------------------

	@Test
	public void streamsCsvWithTheCapInItsHeaders() throws Exception {
		when(store.count(any(AuditLogQuery.class))).thenReturn(7L);
		doAnswer(invocation -> {
			Writer out = invocation.getArgument(2);
			out.write("date,action\r\n2026-09-30,UPDATED\r\n");
			return 1;
		}).when(store).export(any(AuditLogQuery.class), anyInt(), any(Writer.class));

		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.export(null, null, null, null, "UPDATED", null, 5, response);

		assertEquals(200, response.getStatus());
		assertThat(response.getContentType(), containsString("text/csv"));
		assertThat(response.getHeader("Content-Disposition"), containsString("attachment; filename=\"audit-log-"));
		assertEquals("7", response.getHeader("X-Total-Count"));
		assertEquals("5", response.getHeader("X-Row-Cap"));
		assertEquals("true", response.getHeader("X-Truncated"));
		assertEquals("no-store", response.getHeader("Cache-Control"));
		assertEquals("date,action\r\n2026-09-30,UPDATED\r\n", response.getContentAsString());
		verify(store).export(any(AuditLogQuery.class), eq(5), any(Writer.class));
	}

	@Test
	public void csvCapNeverExceedsTheMaximum() throws Exception {
		when(store.count(any(AuditLogQuery.class))).thenReturn(3L);
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.export(null, null, null, null, null, null, 10000000, response);
		assertEquals(String.valueOf(AuditLogStore.MAX_EXPORT_ROWS), response.getHeader("X-Row-Cap"));
		assertEquals("false", response.getHeader("X-Truncated"));
		verify(store).export(any(AuditLogQuery.class), eq(AuditLogStore.MAX_EXPORT_ROWS), any(Writer.class));
	}

	@Test
	public void csvRejectsBadFiltersWith400() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.export(null, null, null, null, "VIEWED", null, null, response);
		assertEquals(400, response.getStatus());
		assertThat(response.getContentType(), containsString("application/json"));
		verifyNoInteractions(store);
	}
}
