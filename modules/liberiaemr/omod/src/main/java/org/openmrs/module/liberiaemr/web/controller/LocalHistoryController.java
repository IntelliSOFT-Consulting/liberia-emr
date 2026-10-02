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
import org.openmrs.module.liberiaemr.web.remotehistory.FacilityHistoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The facility's read of an imported patient's remote history (LE-384), for the External records
 * view. It answers from the local cache, refreshing it first when it is stale and central can be
 * reached; offline it serves the cache with its age.
 */
@Controller
@RequestMapping(value = "/rest/v1/liberiaemr/remotehistory/local")
public class LocalHistoryController {

	private static final Pattern UUID_PATTERN = Pattern
	        .compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

	private static final ObjectMapper MAPPER = new ObjectMapper();

	@Autowired
	private FacilityHistoryService facilityHistoryService;

	/**
	 * @return 200 with {@code status}, {@code centralReachable}, {@code fetchedAt}, {@code ageSeconds}
	 *         and the cached {@code sources}; 400 for a bad UUID; 403 without Get Patients; 404 for a
	 *         patient who is not at this facility
	 */
	@RequestMapping(value = "/{patientUuid}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<String> read(@PathVariable("patientUuid") String patientUuid) throws Exception {
		if (!Context.isAuthenticated() || !Context.hasPrivilege("Get Patients")) {
			return error(HttpStatus.FORBIDDEN, "Get Patients privilege is required");
		}
		if (patientUuid == null || !UUID_PATTERN.matcher(patientUuid.trim()).matches()) {
			return error(HttpStatus.BAD_REQUEST, "patientUuid must be a UUID");
		}
		String uuid = patientUuid.trim();
		// Only a patient who is here: the cache is for imported patients, not a way to pull anyone's.
		if (Context.getPatientService().getPatientByUuid(uuid) == null) {
			return error(HttpStatus.NOT_FOUND, "No patient " + uuid + " at this facility");
		}
		return json(HttpStatus.OK, facilityHistoryService.read(uuid));
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
