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

import java.util.Collections;
import java.util.Map;

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.identity.IdentityService;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * The Central Person Identifier at read time (sync-eip.md 2.5.4). Counts need View Sync Status;
 * a record's links need View Identity Links, because they say which other facilities hold the
 * same person.
 */
@Controller
@RequestMapping("/rest/" + RestConstants.VERSION_1 + "/liberiaemr/identity")
public class IdentityController {

	public static final String PRIVILEGE_VIEW_IDENTITY_LINKS = "View Identity Links";

	@Autowired
	private IdentityService identityService;

	@RequestMapping(value = "/status", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> status() {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(SyncStatusController.PRIVILEGE_VIEW_SYNC_STATUS)) {
			return error(HttpStatus.FORBIDDEN, SyncStatusController.PRIVILEGE_VIEW_SYNC_STATUS + " is required");
		}
		return new ResponseEntity<Map<String, Object>>(identityService.status(), HttpStatus.OK);
	}

	@RequestMapping(value = "/patient/{uuid}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> patient(@PathVariable("uuid") String uuid) {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_VIEW_IDENTITY_LINKS)) {
			return error(HttpStatus.FORBIDDEN, PRIVILEGE_VIEW_IDENTITY_LINKS + " is required");
		}
		try {
			return new ResponseEntity<Map<String, Object>>(identityService.resolve(uuid), HttpStatus.OK);
		}
		catch (IdentityService.NotFoundException e) {
			return error(HttpStatus.NOT_FOUND, e.getMessage());
		}
	}

	private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
		return new ResponseEntity<Map<String, Object>>(Collections.<String, Object> singletonMap("error", message), status);
	}
}
