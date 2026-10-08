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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The facility's read of an imported patient's remote history (LE-384), for the External records
 * view. It answers from the local cache, refreshing it first when it is stale and central can be
 * reached; offline it serves the cache with its age. It also refreshes on request, for an
 * import's last step and the chart's Refresh (LE-387).
 */
@Controller
@RequestMapping(value = "/rest/v1/liberiaemr/remotehistory/local")
public class LocalHistoryController {

	private static final Pattern UUID_PATTERN = Pattern
	        .compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

	/**
	 * Other facilities' records are wider than this facility's own, so reading them takes its own
	 * privilege, held by the clinical roles (Nurse, and Clinician and Midwife through it), not by
	 * everyone with Get Patients. The same privilege gates central's history endpoint.
	 */
	public static final String PRIVILEGE_VIEW_REMOTE_HISTORY = "View Remote History";

	private static final ObjectMapper MAPPER = new ObjectMapper();

	@Autowired
	private FacilityHistoryService facilityHistoryService;

	/**
	 * @return 200 with {@code status}, {@code centralReachable}, {@code fetchedAt}, {@code ageSeconds}
	 *         and the cached {@code sources}; 400 for a bad UUID; 403 without View Remote History or
	 *         Get Patients; 404 for a
	 *         patient who is not at this facility
	 */
	@RequestMapping(value = "/{patientUuid}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<String> read(@PathVariable("patientUuid") String patientUuid) throws Exception {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_VIEW_REMOTE_HISTORY)) {
			return error(HttpStatus.FORBIDDEN, PRIVILEGE_VIEW_REMOTE_HISTORY + " privilege is required");
		}
		if (!Context.hasPrivilege("Get Patients")) {
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

	/**
	 * Fetches the patient's history from central now: the last step of an import (LE-387) and the
	 * chart's Refresh. Answers with the outcome and the state of the cache, not the records, so a
	 * Records Officer who may import but not view other facilities' records can run the import's
	 * last step.
	 *
	 * @param payload optional {@code {reason}}, logged with the fetch; "routine refresh" when absent
	 * @return 200 with {@code attempt}, {@code history}, {@code status}, {@code facilityCount} and
	 *         {@code fetchedAt}, whether or not central answered; 400 for a bad UUID; 403 without View
	 *         Remote History or Import Remote Patient, or without Get Patients; 404 for a patient who
	 *         is not at this facility
	 */
	@RequestMapping(value = "/{patientUuid}/refresh", method = RequestMethod.POST)
	@ResponseBody
	public ResponseEntity<String> refresh(@PathVariable("patientUuid") String patientUuid,
	        @RequestBody(required = false) Map<String, Object> payload) throws Exception {
		if (!Context.isAuthenticated() || !(Context.hasPrivilege(PRIVILEGE_VIEW_REMOTE_HISTORY)
		        || Context.hasPrivilege(RemoteSearchController.PRIVILEGE_IMPORT_REMOTE_PATIENT))) {
			return error(HttpStatus.FORBIDDEN, PRIVILEGE_VIEW_REMOTE_HISTORY + " or "
			        + RemoteSearchController.PRIVILEGE_IMPORT_REMOTE_PATIENT + " privilege is required");
		}
		if (!Context.hasPrivilege("Get Patients")) {
			return error(HttpStatus.FORBIDDEN, "Get Patients privilege is required");
		}
		if (patientUuid == null || !UUID_PATTERN.matcher(patientUuid.trim()).matches()) {
			return error(HttpStatus.BAD_REQUEST, "patientUuid must be a UUID");
		}
		String uuid = patientUuid.trim();
		if (Context.getPatientService().getPatientByUuid(uuid) == null) {
			return error(HttpStatus.NOT_FOUND, "No patient " + uuid + " at this facility");
		}
		Object given = payload == null ? null : payload.get("reason");
		String reason = given instanceof String && !((String) given).trim().isEmpty() ? ((String) given).trim()
		        : FacilityHistoryService.REASON_ROUTINE_REFRESH;
		return json(HttpStatus.OK, facilityHistoryService.refreshNow(uuid, reason));
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
