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

import java.util.Map;

import org.openmrs.module.liberiaemr.api.LiberiaEMRService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * Controller for handling password reset requests and confirmations.
 * Mapped outside of /ws/rest/v1 to bypass the RestAuthFilter.
 */
@Controller
@RequestMapping("/liberiaemr/passwordReset")
public class PasswordResetController {

	private static final Logger log = LoggerFactory.getLogger(PasswordResetController.class);

	@Autowired
	private LiberiaEMRService liberiaEMRService;

	@RequestMapping(value = "/request", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<String> requestReset(@RequestBody Map<String, String> payload) {
		String email = payload.get("email");
		if (email == null || email.trim().isEmpty()) {
			log.warn("AUDIT: Password reset request failed. Reason: Email is missing or empty.");
			return new ResponseEntity<>("Email is required", HttpStatus.BAD_REQUEST);
		}

		try {
			log.info("AUDIT: Password reset request initiated for email: {}", email.trim());
			liberiaEMRService.requestPasswordReset(email.trim());
			log.info("AUDIT: Password reset request processed successfully for email: {}", email.trim());
			return new ResponseEntity<>("Request processed", HttpStatus.OK);
		} catch (Exception e) {
			log.error("AUDIT: Password reset request failed for email: {}. Error: {}", email.trim(), e.getMessage(), e);
			return new ResponseEntity<>(e.getMessage(), HttpStatus.INTERNAL_SERVER_ERROR);
		}
	}

	@RequestMapping(value = "/confirm", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<String> confirmReset(@RequestBody Map<String, String> payload) {
		String token = payload.get("token");
		String newPassword = payload.get("newPassword");

		if (token == null || newPassword == null || token.trim().isEmpty() || newPassword.trim().isEmpty()) {
			log.warn("AUDIT: Password reset confirmation failed. Reason: Token or new password missing.");
			return new ResponseEntity<>("Token and newPassword are required", HttpStatus.BAD_REQUEST);
		}

		try {
			log.info("AUDIT: Password reset confirmation initiated for token: {}", token.trim());
			liberiaEMRService.confirmPasswordReset(token.trim(), newPassword.trim());
			log.info("AUDIT: Password reset confirmation successful for token: {}", token.trim());
			return new ResponseEntity<>("Password reset successful", HttpStatus.OK);
		} catch (Exception e) {
			log.error("AUDIT: Password reset confirmation failed for token: {}. Error: {}", token.trim(), e.getMessage(), e);
			return new ResponseEntity<>(e.getMessage(), HttpStatus.BAD_REQUEST);
		}
	}
}
