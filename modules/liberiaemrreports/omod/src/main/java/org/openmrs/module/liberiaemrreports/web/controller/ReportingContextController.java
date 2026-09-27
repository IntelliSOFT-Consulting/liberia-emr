/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.web.controller;

import java.util.Collections;
import java.util.Map;

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.context.ReportingContextService;
import org.openmrs.module.liberiaemrreports.security.NationalReportPrivilege;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * {@code GET /ws/rest/v1/liberiaemrreports/context}: this instance's role, its own facility and the
 * last ETL run, for the report UI. Guarded by {@value NationalReportPrivilege#PRIVILEGE}.
 * <p>
 * The path is spelled out rather than built from webservices.rest's {@code RestConstants}, so the
 * module needs no dependency on that module; /ws/rest/* reaches OpenMRS's dispatcher either way.
 */
@Controller
@RequestMapping("/rest/v1/liberiaemrreports")
public class ReportingContextController {
	
	@Autowired
	private ReportingContextService reportingContextService;
	
	@RequestMapping(value = "/context", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> getContext() {
		if (!Context.isAuthenticated()) {
			return error(HttpStatus.UNAUTHORIZED, "Authentication is required");
		}
		if (!Context.hasPrivilege(NationalReportPrivilege.PRIVILEGE)) {
			return error(HttpStatus.FORBIDDEN, NationalReportPrivilege.PRIVILEGE + " is required");
		}
		return new ResponseEntity<Map<String, Object>>(reportingContextService.getContext(), HttpStatus.OK);
	}
	
	private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
		return new ResponseEntity<Map<String, Object>>(Collections.<String, Object> singletonMap("error", message), status);
	}
	
	void setReportingContextService(ReportingContextService reportingContextService) {
		this.reportingContextService = reportingContextService;
	}
}
