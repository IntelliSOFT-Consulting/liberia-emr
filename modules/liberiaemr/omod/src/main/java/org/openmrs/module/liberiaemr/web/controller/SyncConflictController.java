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
import org.openmrs.module.liberiaemr.sync.SyncConflictService;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * The sync conflicts page's endpoint. Every call, reads included, needs Resolve Sync Conflicts
 * because a conflict carries a patient record.
 */
@Controller
@RequestMapping("/rest/" + RestConstants.VERSION_1 + "/liberiaemr/syncconflicts")
public class SyncConflictController {

	public static final String PRIVILEGE_RESOLVE_SYNC_CONFLICTS = "Resolve Sync Conflicts";

	@Autowired
	private SyncConflictService syncConflictService;

	@RequestMapping(method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> list() {
		if (!permitted()) {
			return forbidden();
		}
		return new ResponseEntity<Map<String, Object>>(syncConflictService.list(), HttpStatus.OK);
	}

	@RequestMapping(value = "/{id}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> get(@PathVariable("id") long id) {
		if (!permitted()) {
			return forbidden();
		}
		try {
			return new ResponseEntity<Map<String, Object>>(syncConflictService.get(id), HttpStatus.OK);
		}
		catch (SyncConflictService.NotFoundException e) {
			return error(HttpStatus.NOT_FOUND, e.getMessage());
		}
	}

	@RequestMapping(value = "/{id}/decision", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> decide(@PathVariable("id") long id,
	        @RequestBody Map<String, Object> body) {
		if (!permitted()) {
			return forbidden();
		}
		try {
			return new ResponseEntity<Map<String, Object>>(syncConflictService.decide(id, text(body, "identifier"),
			    text(body, "decision"), text(body, "reason"), Context.getAuthenticatedUser()), HttpStatus.CREATED);
		}
		catch (SyncConflictService.NotFoundException e) {
			return error(HttpStatus.NOT_FOUND, e.getMessage());
		}
		catch (SyncConflictService.StaleException e) {
			return error(HttpStatus.CONFLICT, e.getMessage());
		}
		catch (IllegalArgumentException | IllegalStateException e) {
			return error(HttpStatus.BAD_REQUEST, e.getMessage());
		}
	}

	private static boolean permitted() {
		return Context.isAuthenticated() && Context.hasPrivilege(PRIVILEGE_RESOLVE_SYNC_CONFLICTS);
	}

	private static ResponseEntity<Map<String, Object>> forbidden() {
		return error(HttpStatus.FORBIDDEN, PRIVILEGE_RESOLVE_SYNC_CONFLICTS + " is required");
	}

	private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
		return new ResponseEntity<Map<String, Object>>(Collections.<String, Object> singletonMap("error", message), status);
	}

	private static String text(Map<String, Object> body, String key) {
		Object value = body == null ? null : body.get(key);
		return value == null ? null : value.toString();
	}
}
