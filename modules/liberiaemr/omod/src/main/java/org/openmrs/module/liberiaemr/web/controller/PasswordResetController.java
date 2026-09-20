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

import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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
 * Controller for handling password reset requests and confirmations. Mapped outside of
 * /ws/rest/v1 to bypass the RestAuthFilter.
 */
@Controller
@RequestMapping("/liberiaemr/passwordReset")
public class PasswordResetController {
	
	private static final Logger log = LoggerFactory.getLogger(PasswordResetController.class);
	
	/**
	 * What an anonymous caller is told when /confirm fails, whatever the reason. Returning the
	 * exception message instead would tell an attacker apart "no such token", "token expired"
	 * and a stack trace from the persistence layer; the service log already records which.
	 */
	private static final String GENERIC_CONFIRM_FAILURE = "The reset link is invalid or has expired, or the new password does not meet the password policy.";
	
	private static final String GENERIC_REQUEST_FAILURE = "The password reset request could not be processed.";
	
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
		}
		catch (Exception e) {
			log.error("AUDIT: Password reset request failed for email: {}. Error: {}", email.trim(), e.getMessage(), e);
			return new ResponseEntity<>(GENERIC_REQUEST_FAILURE, HttpStatus.INTERNAL_SERVER_ERROR);
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
		
		// The token is a BEARER SECRET: whoever holds it can set this account's password until it
		// expires, without access to the mailbox it was sent to. Audit logs are retained for at
		// least three months (MOH ICT SOP) and shipped to the SIEM, so a raw token written here
		// would outlive the token in a store readable by far more people than the victim's inbox.
		// The fingerprint correlates the lines of one attempt without being replayable.
		String tokenRef = fingerprint(token.trim());
		
		try {
			log.info("AUDIT: Password reset confirmation initiated for token fingerprint: {}", tokenRef);
			liberiaEMRService.confirmPasswordReset(token.trim(), newPassword.trim());
			log.info("AUDIT: Password reset confirmation successful for token fingerprint: {}", tokenRef);
			return new ResponseEntity<>("Password reset successful", HttpStatus.OK);
		}
		catch (Exception e) {
			log.warn("AUDIT: Password reset confirmation failed for token fingerprint: {}. Reason: {}", tokenRef,
			    e.getMessage());
			return new ResponseEntity<>(GENERIC_CONFIRM_FAILURE, HttpStatus.BAD_REQUEST);
		}
	}
	
	/**
	 * A one-way, truncated SHA-256 of the token, for correlating audit lines to one attempt. Not
	 * a credential: it cannot be presented to /confirm, and 12 hex characters of a digest of a
	 * random UUID does not lead back to the UUID.
	 *
	 * @param token the raw token
	 * @return 12 hex characters, or "unhashable" if this JVM has no SHA-256 or no UTF-8
	 */
	static String fingerprint(String token) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes("UTF-8"));
			StringBuilder hex = new StringBuilder(12);
			for (int i = 0; i < 6; i++) {
				hex.append(String.format("%02x", digest[i]));
			}
			return hex.toString();
		}
		catch (NoSuchAlgorithmException e) {
			// Every JVM ships SHA-256. If this one does not, log nothing rather than the token.
			return "unhashable";
		}
		catch (UnsupportedEncodingException e) {
			return "unhashable";
		}
	}
}
