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

import javax.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.audit.AuditLogQuery;
import org.openmrs.module.liberiaemr.audit.AuditLogStore;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The ICT Unit's audit log viewer (MOH ICT SOP control B3): a read-only view of the auditlog
 * module's table. Every call needs Get Audit Logs, the auditlog module's own privilege, which the
 * ICT Auditor role holds and no clinical role does; where the module is not running the privilege
 * does not exist, so only a superuser gets past the check, and then gets 503. Nothing here writes.
 */
@Controller
@RequestMapping("/rest/" + RestConstants.VERSION_1 + "/liberiaemr/auditlog")
public class AuditLogController {

	private static final Logger log = LoggerFactory.getLogger(AuditLogController.class);

	@Autowired
	private AuditLogStore store;

	void setStore(AuditLogStore store) {
		this.store = store;
	}

	@RequestMapping(method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> list(@RequestParam(value = "from", required = false) String from,
	        @RequestParam(value = "to", required = false) String to,
	        @RequestParam(value = "user", required = false) String user,
	        @RequestParam(value = "type", required = false) String type,
	        @RequestParam(value = "action", required = false) String action,
	        @RequestParam(value = "topLevelOnly", required = false) Boolean topLevelOnly,
	        @RequestParam(value = "startIndex", required = false) Integer startIndex,
	        @RequestParam(value = "limit", required = false) Integer limit) {
		ResponseEntity<Map<String, Object>> refused = refusal();
		if (refused != null) {
			return refused;
		}
		AuditLogQuery query;
		try {
			query = AuditLogQuery.parse(from, to, user, type, action, topLevelOnly, startIndex, limit);
		}
		catch (IllegalArgumentException e) {
			return error(HttpStatus.BAD_REQUEST, e.getMessage());
		}
		try {
			return ok(store.list(query));
		}
		catch (AuditLogStore.UnavailableException e) {
			return error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
		}
	}

	@RequestMapping(value = "/types", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> types() {
		ResponseEntity<Map<String, Object>> refused = refusal();
		if (refused != null) {
			return refused;
		}
		try {
			List<Map<String, Object>> types = store.types();
			return ok(Collections.<String, Object> singletonMap("results", types));
		}
		catch (AuditLogStore.UnavailableException e) {
			return error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
		}
	}

	/**
	 * The same filters as the list, as CSV, newest first, at most {@code limit} rows
	 * ({@link AuditLogStore#MAX_EXPORT_ROWS} by default and at most). X-Total-Count says how many
	 * rows matched and X-Truncated whether the file stops short of them.
	 */
	@RequestMapping(value = "/export", method = RequestMethod.GET)
	public void export(@RequestParam(value = "from", required = false) String from,
	        @RequestParam(value = "to", required = false) String to,
	        @RequestParam(value = "user", required = false) String user,
	        @RequestParam(value = "type", required = false) String type,
	        @RequestParam(value = "action", required = false) String action,
	        @RequestParam(value = "topLevelOnly", required = false) Boolean topLevelOnly,
	        @RequestParam(value = "limit", required = false) Integer limit, HttpServletResponse response)
	        throws IOException {
		ResponseEntity<Map<String, Object>> refused = refusal();
		if (refused != null) {
			write(response, refused);
			return;
		}
		AuditLogQuery query;
		try {
			query = AuditLogQuery.parse(from, to, user, type, action, topLevelOnly, 0, 1);
		}
		catch (IllegalArgumentException e) {
			write(response, error(HttpStatus.BAD_REQUEST, e.getMessage()));
			return;
		}
		int cap = limit == null ? AuditLogStore.MAX_EXPORT_ROWS : Math.min(Math.max(1, limit),
		    AuditLogStore.MAX_EXPORT_ROWS);
		long total;
		try {
			total = store.count(query);
		}
		catch (AuditLogStore.UnavailableException e) {
			write(response, error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage()));
			return;
		}
		response.setStatus(HttpServletResponse.SC_OK);
		response.setContentType("text/csv;charset=UTF-8");
		response.setHeader("Content-Disposition",
		    "attachment; filename=\"audit-log-" + new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date()) + ".csv\"");
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("X-Total-Count", String.valueOf(total));
		response.setHeader("X-Row-Cap", String.valueOf(cap));
		response.setHeader("X-Truncated", String.valueOf(total > cap));
		Writer out = new OutputStreamWriter(response.getOutputStream(), StandardCharsets.UTF_8);
		int written = store.export(query, cap, out);
		out.flush();
		// Who exported how much, never what: the rows themselves may be PHI.
		log.info("Audit log export by {}: {} of {} matching rows", currentUsername(), written, total);
	}

	@RequestMapping(value = "/{uuid}", method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> get(@PathVariable("uuid") String uuid) {
		ResponseEntity<Map<String, Object>> refused = refusal();
		if (refused != null) {
			return refused;
		}
		try {
			Map<String, Object> row = store.get(uuid);
			return row == null ? error(HttpStatus.NOT_FOUND, "No audit log entry " + uuid) : ok(row);
		}
		catch (AuditLogStore.UnavailableException e) {
			return error(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
		}
	}

	/** Overridden in tests, which have no OpenMRS context. */
	protected boolean permitted() {
		return Context.isAuthenticated() && Context.hasPrivilege(AuditLogStore.PRIVILEGE);
	}

	protected String currentUsername() {
		return Context.isAuthenticated() ? Context.getAuthenticatedUser().getUsername() : null;
	}

	/** 403 without the privilege, whether or not the module is running; null to go on. */
	private ResponseEntity<Map<String, Object>> refusal() {
		if (!permitted()) {
			return error(HttpStatus.FORBIDDEN, AuditLogStore.PRIVILEGE + " is required");
		}
		return null;
	}

	private static void write(HttpServletResponse response, ResponseEntity<Map<String, Object>> entity)
	        throws IOException {
		response.setStatus(entity.getStatusCodeValue());
		response.setContentType("application/json;charset=UTF-8");
		new ObjectMapper().writeValue(response.getOutputStream(), entity.getBody());
	}

	private static ResponseEntity<Map<String, Object>> ok(Map<String, Object> body) {
		return new ResponseEntity<Map<String, Object>>(body, HttpStatus.OK);
	}

	private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
		Map<String, Object> body = new LinkedHashMap<String, Object>();
		body.put("error", message);
		return new ResponseEntity<Map<String, Object>>(body, status);
	}
}
