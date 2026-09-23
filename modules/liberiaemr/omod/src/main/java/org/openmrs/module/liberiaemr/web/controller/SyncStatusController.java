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
import org.openmrs.module.liberiaemr.web.sync.SyncStatusService;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * Serves the national sync status page its numbers: which facilities are sending, and what is
 * waiting at central.
 *
 * Mapped under /ws/rest so the REST authentication filter requires a session, unlike the
 * password reset controller, which is deliberately anonymous. Reading this tells an operator
 * how the country's facilities are syncing, so it also needs the View Sync Status privilege.
 */
@Controller
@RequestMapping("/rest/" + RestConstants.VERSION_1 + "/liberiaemr/syncstatus")
public class SyncStatusController {
	
	public static final String PRIVILEGE_VIEW_SYNC_STATUS = "View Sync Status";
	
	@Autowired
	private SyncStatusService syncStatusService;
	
	@RequestMapping(method = RequestMethod.GET)
	@ResponseBody
	public ResponseEntity<Map<String, Object>> getSyncStatus() {
		if (!Context.isAuthenticated() || !Context.hasPrivilege(PRIVILEGE_VIEW_SYNC_STATUS)) {
			return new ResponseEntity<Map<String, Object>>(
			        Collections.<String, Object> singletonMap("error", "View Sync Status is required"),
			        HttpStatus.FORBIDDEN);
		}
		
		return new ResponseEntity<Map<String, Object>>(syncStatusService.getStatus(), HttpStatus.OK);
	}
}
