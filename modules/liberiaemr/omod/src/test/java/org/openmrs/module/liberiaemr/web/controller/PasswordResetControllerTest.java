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

import org.junit.Before;
import org.junit.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.openmrs.api.APIException;
import org.openmrs.module.liberiaemr.api.LiberiaEMRService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.doThrow;

public class PasswordResetControllerTest {

	@InjectMocks
	PasswordResetController controller;

	@Mock
	LiberiaEMRService liberiaEMRService;

	@Before
	public void setupMocks() {
		MockitoAnnotations.initMocks(this);
	}

	@Test
	public void requestReset_shouldReturnOkWhenEmailProvided() {
		// Given
		Map<String, String> payload = new HashMap<>();
		payload.put("email", "test@example.com");

		// When
		ResponseEntity<String> response = controller.requestReset(payload);

		// Then
		assertEquals(HttpStatus.OK, response.getStatusCode());
		verify(liberiaEMRService).requestPasswordReset("test@example.com");
	}

	@Test
	public void requestReset_shouldReturnBadRequestWhenEmailMissing() {
		// Given
		Map<String, String> payload = new HashMap<>();
		// No email in payload

		// When
		ResponseEntity<String> response = controller.requestReset(payload);

		// Then
		assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
		verify(liberiaEMRService, never()).requestPasswordReset(anyString());
	}

	@Test
	public void requestReset_shouldReturnInternalServerErrorOnException() {
		// Given
		Map<String, String> payload = new HashMap<>();
		payload.put("email", "test@example.com");

		doThrow(new RuntimeException("Database down")).when(liberiaEMRService).requestPasswordReset("test@example.com");

		// When
		ResponseEntity<String> response = controller.requestReset(payload);

		// Then
		assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
	}

	@Test
	public void confirmReset_shouldReturnOkWhenTokenAndNewPasswordProvided() {
		// Given
		Map<String, String> payload = new HashMap<>();
		payload.put("token", "valid-token");
		payload.put("newPassword", "strongPass123");

		// When
		ResponseEntity<String> response = controller.confirmReset(payload);

		// Then
		assertEquals(HttpStatus.OK, response.getStatusCode());
		verify(liberiaEMRService).confirmPasswordReset("valid-token", "strongPass123");
	}

	@Test
	public void confirmReset_shouldReturnBadRequestWhenTokenMissing() {
		// Given
		Map<String, String> payload = new HashMap<>();
		payload.put("newPassword", "strongPass123");

		// When
		ResponseEntity<String> response = controller.confirmReset(payload);

		// Then
		assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
		verify(liberiaEMRService, never()).confirmPasswordReset(anyString(), anyString());
	}

	@Test
	public void confirmReset_shouldReturnBadRequestWhenServiceThrowsException() {
		// Given
		Map<String, String> payload = new HashMap<>();
		payload.put("token", "invalid-token");
		payload.put("newPassword", "strongPass123");

		doThrow(new APIException("Invalid or expired token")).when(liberiaEMRService).confirmPasswordReset("invalid-token", "strongPass123");

		// When
		ResponseEntity<String> response = controller.confirmReset(payload);

		// Then
		assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
	}
}
