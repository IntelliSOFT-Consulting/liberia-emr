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
import java.util.LinkedHashMap;
import java.util.Map;

import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.mfl.MflAction;
import org.openmrs.module.liberiaemr.mfl.MflConstants;
import org.openmrs.module.liberiaemr.mfl.MflSyncService;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * The MFL sync page's endpoint (docs/architecture/mfl-sync-api.md, ADR 0009). Reads need View MFL
 * Sync and changes need Manage MFL Sync. No response carries the MFL password: the service never
 * holds it in anything it returns.
 */
@Controller
@RequestMapping("/rest/" + RestConstants.VERSION_1 + "/liberiaemr/mfl")
public class MflSyncController {

	static final String RUNS_PATH = "/ws/rest/" + RestConstants.VERSION_1 + "/liberiaemr/mfl/runs/";

	@Autowired
	private MflSyncService service;

	void setService(MflSyncService service) {
		this.service = service;
	}

	@RequestMapping(value = "/status", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> status() {
		if (!permitted(MflConstants.PRIVILEGE_VIEW)) {
			return forbidden(MflConstants.PRIVILEGE_VIEW);
		}
		return ok(service.getStatus());
	}

	@RequestMapping(value = "/config", method = RequestMethod.PUT)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> updateConfig(@RequestBody(required = false) Map<String, Object> body) {
		if (!permitted(MflConstants.PRIVILEGE_MANAGE)) {
			return forbidden(MflConstants.PRIVILEGE_MANAGE);
		}
		try {
			return ok(service.updateConfig(body));
		}
		catch (IllegalArgumentException e) {
			return error(HttpStatus.BAD_REQUEST, e.getMessage());
		}
	}

	@RequestMapping(value = "/test-connection", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> testConnection() {
		if (!permitted(MflConstants.PRIVILEGE_MANAGE)) {
			return forbidden(MflConstants.PRIVILEGE_MANAGE);
		}
		try {
			return ok(service.testConnection());
		}
		catch (MflSyncService.UnavailableException e) {
			return error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
		}
	}

	@RequestMapping(value = "/runs", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> startRun(@RequestBody(required = false) Map<String, Object> body) {
		if (!permitted(MflConstants.PRIVILEGE_MANAGE)) {
			return forbidden(MflConstants.PRIVILEGE_MANAGE);
		}
		Object dryRun = body == null ? null : body.get("dryRun");
		if (dryRun != null && !(dryRun instanceof Boolean)) {
			return error(HttpStatus.BAD_REQUEST, "dryRun must be true or false");
		}
		try {
			Map<String, Object> run = service.startRun(Boolean.TRUE.equals(dryRun), currentUser());
			HttpHeaders headers = new HttpHeaders();
			headers.add("Location", RUNS_PATH + run.get("id"));
			return new ResponseEntity<Map<String, Object>>(run, headers, HttpStatus.ACCEPTED);
		}
		catch (MflSyncService.UnavailableException e) {
			return error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
		}
		catch (MflSyncService.BusyException e) {
			Map<String, Object> busy = new LinkedHashMap<String, Object>();
			busy.put("error", e.getMessage());
			busy.put("runId", e.getRunId());
			return new ResponseEntity<Map<String, Object>>(busy, HttpStatus.CONFLICT);
		}
	}

	@RequestMapping(value = "/runs", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> runs(@RequestParam(value = "startIndex", defaultValue = "0") int startIndex,
	        @RequestParam(value = "limit", defaultValue = "20") int limit) {
		if (!permitted(MflConstants.PRIVILEGE_VIEW)) {
			return forbidden(MflConstants.PRIVILEGE_VIEW);
		}
		return ok(service.getRuns(Math.max(0, startIndex), clamp(limit, 100)));
	}

	@RequestMapping(value = "/runs/{id}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> run(@PathVariable("id") int id) {
		if (!permitted(MflConstants.PRIVILEGE_VIEW)) {
			return forbidden(MflConstants.PRIVILEGE_VIEW);
		}
		Map<String, Object> run = service.getRun(id);
		return run == null ? error(HttpStatus.NOT_FOUND, "No MFL sync run " + id) : ok(run);
	}

	@RequestMapping(value = "/runs/{id}/items", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> items(@PathVariable("id") int id,
	        @RequestParam(value = "action", required = false) String action,
	        @RequestParam(value = "startIndex", defaultValue = "0") int startIndex,
	        @RequestParam(value = "limit", defaultValue = "50") int limit) {
		if (!permitted(MflConstants.PRIVILEGE_VIEW)) {
			return forbidden(MflConstants.PRIVILEGE_VIEW);
		}
		if (action != null) {
			try {
				MflAction.valueOf(action);
			}
			catch (IllegalArgumentException e) {
				return error(HttpStatus.BAD_REQUEST, "action must be one of CREATE, UPDATE, RETIRE, UNRETIRE, WARNING, ERROR");
			}
		}
		Map<String, Object> items = service.getItems(id, action, Math.max(0, startIndex), clamp(limit, 200));
		return items == null ? error(HttpStatus.NOT_FOUND, "No MFL sync run " + id) : ok(items);
	}

	/** Overridden in tests, which have no OpenMRS context. */
	protected boolean permitted(String privilege) {
		return Context.isAuthenticated() && Context.hasPrivilege(privilege);
	}

	protected User currentUser() {
		return Context.getAuthenticatedUser();
	}

	private static int clamp(int limit, int max) {
		return Math.min(Math.max(1, limit), max);
	}

	private static ResponseEntity<Map<String, Object>> ok(Map<String, Object> body) {
		return new ResponseEntity<Map<String, Object>>(body, HttpStatus.OK);
	}

	private static ResponseEntity<Map<String, Object>> forbidden(String privilege) {
		return error(HttpStatus.FORBIDDEN, privilege + " is required");
	}

	private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
		return new ResponseEntity<Map<String, Object>>(Collections.<String, Object> singletonMap("error", message), status);
	}
}
