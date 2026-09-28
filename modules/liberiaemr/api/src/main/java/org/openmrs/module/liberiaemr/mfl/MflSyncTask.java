/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

import org.openmrs.api.context.Context;
import org.openmrs.scheduler.tasks.AbstractTask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The daily MFL sync on the OpenMRS scheduler, at liberiaemr.mfl.schedule.time. It runs only while
 * liberiaemr.mfl.enabled is true and credentials are configured; the service decides, so every
 * instance carries the task harmlessly.
 */
public class MflSyncTask extends AbstractTask {

	public static final String NAME = "LiberiaEMR MFL Sync";

	private static final Logger log = LoggerFactory.getLogger(MflSyncTask.class);

	@Override
	public void execute() {
		try {
			Context.getRegisteredComponent("liberiaemr.MflSyncService", MflSyncService.class).runScheduled();
		}
		catch (Exception e) {
			log.error("MFL sync task failed", e);
		}
	}
}
