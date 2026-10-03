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

import java.util.regex.Pattern;

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.web.remotehistory.InstanceRole;
import org.openmrs.module.liberiaemr.web.remotehistory.RemoteHistoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Central's remote history endpoint (LE-382, ADR 0013): one patient's ADR-scoped history, grouped
 * by source facility, for a facility that imported them. Patient-scoped only; there is no list or
 * bulk form. It answers at central only, and only reads.
 */
@Controller
@RequestMapping(value = "/rest/v1/liberiaemr/remotehistory")
public class RemoteHistoryController {

	public static final String PRIVILEGE_VIEW_REMOTE_HISTORY = "View Remote History";

	private static final Pattern UUID_PATTERN = Pattern
	        .compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

	private static final ObjectMapper MAPPER = new ObjectMapper();

	@Autowired
	private RemoteHistoryService remoteHistoryService;

	/**
	 * @param patientUuid the patient
	 * @param requestingFacility the asking facility's location UUID; its own records are left out
	 * @return 200 with {@code sources} (empty, not 404, when nothing is visible); 400 for a bad UUID;
	 *         403 without View Remote History; 404 on a facility, where there is nothing to serve
	 */
	@RequestMapping(value = "/{patientUuid}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<String> history(@PathVariable("patientUuid") String patientUuid,
	        @RequestParam(value = "requestingFacility", required = false) String requestingFacility) throws Exception {
		if (InstanceRole.current() != InstanceRole.CENTRAL) {
			return error(HttpStatus.NOT_FOUND, "Remote history is served by central only");
		}
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_VIEW_REMOTE_HISTORY)) {
			return error(HttpStatus.FORBIDDEN, PRIVILEGE_VIEW_REMOTE_HISTORY + " privilege is required");
		}
		if (!valid(patientUuid) || (requestingFacility != null && !valid(requestingFacility))) {
			return error(HttpStatus.BAD_REQUEST, "patientUuid and requestingFacility must be UUIDs");
		}
		ObjectNode body = remoteHistoryService.historyFor(patientUuid.trim(),
		    requestingFacility == null ? null : requestingFacility.trim());
		return json(HttpStatus.OK, body);
	}

	private static boolean valid(String value) {
		return value != null && UUID_PATTERN.matcher(value.trim()).matches();
	}

	private static ResponseEntity<String> error(HttpStatus status, String message) throws Exception {
		ObjectNode body = MAPPER.createObjectNode();
		body.put("error", message);
		return json(status, body);
	}

	private static ResponseEntity<String> json(HttpStatus status, ObjectNode body) throws Exception {
		HttpHeaders headers = new HttpHeaders();
		headers.setContentType(MediaType.APPLICATION_JSON);
		return new ResponseEntity<String>(MAPPER.writeValueAsString(body), headers, status);
	}
}
