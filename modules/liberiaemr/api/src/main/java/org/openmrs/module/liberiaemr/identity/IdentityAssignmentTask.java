/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.openmrs.api.context.Context;
import org.openmrs.scheduler.tasks.AbstractTask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs the identity service on the OpenMRS scheduler at central, every liberiaemr.identity.intervalSeconds.
 */
public class IdentityAssignmentTask extends AbstractTask {

	public static final String NAME = "LiberiaEMR Identity Assignment";

	private static final Logger log = LoggerFactory.getLogger(IdentityAssignmentTask.class);

	/** Static, because a reschedule starts a new instance while the old one may still be running. */
	private static final AtomicBoolean RUNNING = new AtomicBoolean();

	@Override
	public void execute() {
		if (!RUNNING.compareAndSet(false, true)) {
			return;
		}
		try {
			IdentityService service = Context.getRegisteredComponent("liberiaemr.IdentityService", IdentityService.class);
			Map<String, Object> result = service.assignPending();
			if (Boolean.TRUE.equals(result.get("enabled")) && ((Number) result.get("assigned")).intValue() > 0) {
				log.info("Identity: assigned {} CPI(s), linked {} on National ID, {} for review", result.get("assigned"),
				    result.get("linked"), result.get("forReview"));
			}
		}
		catch (Exception e) {
			log.error("Identity task failed", e);
		}
		finally {
			RUNNING.set(false);
		}
	}
}
