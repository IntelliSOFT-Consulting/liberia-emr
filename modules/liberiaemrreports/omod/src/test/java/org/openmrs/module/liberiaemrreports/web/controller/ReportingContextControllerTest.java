/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.web.controller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.UserContext;
import org.openmrs.module.liberiaemrreports.context.ReportingContextService;
import org.openmrs.module.liberiaemrreports.security.NationalReportPrivilege;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * {@code GET /ws/rest/v1/liberiaemrreports/context}: 401 without a session, 403 without Export
 * National Report, and the service's map otherwise ({@code docs/reporting/README.md} §4.4).
 */
public class ReportingContextControllerTest {

	private final ReportingContextService service = mock(ReportingContextService.class);

	private final UserContext userContext = mock(UserContext.class);

	private final ReportingContextController controller = new ReportingContextController();

	@Before
	public void setUp() {
		controller.setReportingContextService(service);
		Context.setUserContext(userContext);
	}

	@After
	public void tearDown() {
		Context.clearUserContext();
	}

	@Test
	public void shouldAnswer401WithoutASession() {
		ResponseEntity<Map<String, Object>> response = controller.getContext();
		assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
		assertTrue(response.getBody().containsKey("error"));
		verify(service, never()).getContext();
	}

	@Test
	public void shouldAnswer403WithoutExportNationalReport() {
		when(userContext.getAuthenticatedUser()).thenReturn(new User());
		when(userContext.hasPrivilege(NationalReportPrivilege.PRIVILEGE)).thenReturn(false);
		ResponseEntity<Map<String, Object>> response = controller.getContext();
		assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
		assertTrue(String.valueOf(response.getBody().get("error")).contains(NationalReportPrivilege.PRIVILEGE));
		verify(service, never()).getContext();
	}

	@Test
	public void shouldReturnTheContextWithExportNationalReport() {
		when(userContext.getAuthenticatedUser()).thenReturn(new User());
		when(userContext.hasPrivilege(NationalReportPrivilege.PRIVILEGE)).thenReturn(true);
		Map<String, Object> body = Collections.<String, Object> singletonMap("instanceRole", "facility");
		when(service.getContext()).thenReturn(body);
		ResponseEntity<Map<String, Object>> response = controller.getContext();
		assertEquals(HttpStatus.OK, response.getStatusCode());
		assertSame(body, response.getBody());
	}
}
