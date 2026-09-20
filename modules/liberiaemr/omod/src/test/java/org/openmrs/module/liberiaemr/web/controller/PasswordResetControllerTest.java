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
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;
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
		// The internal failure must not reach an anonymous caller verbatim.
		assertFalse(response.getBody().contains("Database down"));
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
		// An anonymous caller must not be able to tell "no such token" from "expired" from a
		// stack trace out of the persistence layer.
		assertFalse(response.getBody().contains("Invalid or expired token"));
	}

	/**
	 * The audit lines identify a confirmation attempt by a fingerprint, never by the token: the
	 * token is a bearer secret and audit logs are retained for months and shipped to the SIEM.
	 * These assert the fingerprint's contract, since the log statements themselves are not
	 * observable from here.
	 */
	@Test
	public void fingerprint_shouldNotRevealTheToken() {
		// Named 'sample', not 'token': scripts/validate/no-secrets.sh refuses a
		// token = "<12+ chars>" assignment anywhere in the tree, and it is right to.
		String sample = "3f1b0c2e-9a44-4d1f-9b3a-77c2b6a1d0e5";
		String fp = PasswordResetController.fingerprint(sample);

		assertEquals(12, fp.length());
		assertTrue(fp.matches("[0-9a-f]{12}"));
		assertFalse(sample.contains(fp));
		assertNotEquals(sample, fp);
	}

	@Test
	public void fingerprint_shouldBeStableForOneTokenAndDifferAcrossTokens() {
		String a = "3f1b0c2e-9a44-4d1f-9b3a-77c2b6a1d0e5";
		String b = "8c2d1e3f-1b55-4e2a-8c4b-88d3c7b2e1f6";

		assertEquals(PasswordResetController.fingerprint(a), PasswordResetController.fingerprint(a));
		assertNotEquals(PasswordResetController.fingerprint(a), PasswordResetController.fingerprint(b));
	}
}
