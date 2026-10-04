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

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService.ImportOutcome;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService.RemoteSearchException;
import org.openmrs.module.liberiaemr.web.remotesearch.RemoteSearchService.SearchOutcome;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * Remote patient search: look a patient up on the central server and copy them to this facility.
 * Status codes carry the outcome so the UI can tell "no matches" (200, empty list) from
 * "central unreachable" (502) and "not configured" (503, enabled=false).
 */
@Controller
@RequestMapping(value = "/rest/v1/liberiaemr")
public class RemoteSearchController {

	public static final String PRIVILEGE_SEARCH_PATIENTS = "Get Patients";
	public static final String PRIVILEGE_ADD_PATIENTS = "Add Patients";

	@Autowired
	private RemoteSearchService remoteSearchService;

	/** Whether remote search is configured, so the UI can hide the toggle instead of failing on use. */
	@RequestMapping(value = "/remotesearch/status", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> status() {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_SEARCH_PATIENTS)) {
			return forbidden(PRIVILEGE_SEARCH_PATIENTS);
		}
		return new ResponseEntity<>(Collections.<String, Object>singletonMap("enabled", remoteSearchService.isEnabled()),
				HttpStatus.OK);
	}

	@RequestMapping(value = "/remotesearch", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> searchPatients(@RequestParam(value = "q", required = true) String query) {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_SEARCH_PATIENTS)) {
			return forbidden(PRIVILEGE_SEARCH_PATIENTS);
		}

		Map<String, Object> response = new LinkedHashMap<>();
		try {
			SearchOutcome outcome = remoteSearchService.searchPatients(query);
			response.put("enabled", true);
			response.put("results", outcome.getResults());
			response.put("alreadyLocalCount", outcome.getAlreadyLocalCount());
			return new ResponseEntity<>(response, HttpStatus.OK);
		}
		catch (RemoteSearchException e) {
			return failure(e);
		}
	}

	@RequestMapping(value = "/importpatient", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> importPatient(@RequestBody Map<String, String> payload) {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_ADD_PATIENTS)) {
			return forbidden(PRIVILEGE_ADD_PATIENTS);
		}

		String remoteUuid = payload == null ? null : payload.get("remoteUuid");
		if (!remoteSearchService.isValidUuid(remoteUuid)) {
			return new ResponseEntity<>(Collections.<String, Object>singletonMap("error", "remoteUuid must be a patient UUID"),
					HttpStatus.BAD_REQUEST);
		}

		try {
			Map<String, Object> response = new LinkedHashMap<>();
			ImportOutcome outcome = remoteSearchService.importPatient(remoteUuid);
			response.put("localUuid", outcome.getLocalUuid());
			// false when the patient was already here (a repeat import only adds the rows it lacked)
			response.put("created", outcome.isCreated());
			response.put("status", "success");
			return new ResponseEntity<>(response, HttpStatus.OK);
		}
		catch (RemoteSearchException e) {
			return failure(e);
		}
	}

	private ResponseEntity<Map<String, Object>> forbidden(String privilege) {
		return new ResponseEntity<>(Collections.<String, Object>singletonMap("error", privilege + " privilege is required"),
				HttpStatus.FORBIDDEN);
	}

	private ResponseEntity<Map<String, Object>> failure(RemoteSearchException e) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", e.getMessage());
		if (e.isNotConfigured()) {
			body.put("enabled", false);
		}
		return new ResponseEntity<>(body, e.isNotConfigured() ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY);
	}
}
