/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.lab;

import org.openmrs.api.context.Context;
import org.openmrs.scheduler.SchedulerService;
import org.openmrs.scheduler.TaskDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Keeps the labonfhir module's scheduled tasks off. The LIS (OpenELIS) integration is out of scope
 * for now, and no instance has an LIS to talk to, so its OpenELIS Pull Task (every 30s) and Retry
 * Failed Tasks (hourly) only log errors. labonfhir's own liquibase inserts them with
 * start_on_startup=1, so this runs on every start. Remove it when the LIS integration is taken on
 * (LE-380).
 */
public class LabOnFhirTasks {
	
	static final String TASK_CLASS_PREFIX = "org.openmrs.module.labonfhir.";
	
	private static final Logger log = LoggerFactory.getLogger(LabOnFhirTasks.class);
	
	private LabOnFhirTasks() {
	}
	
	/** Stops the labonfhir tasks and keeps them from starting again. */
	public static void apply() {
		try {
			disable(Context.getSchedulerService());
		}
		catch (Exception e) {
			log.error("Failed to turn off the labonfhir scheduled tasks", e);
		}
	}
	
	/** @return how many tasks were turned off; one that fails is logged and the rest still are */
	static int disable(SchedulerService scheduler) {
		int disabled = 0;
		for (TaskDefinition task : scheduler.getRegisteredTasks()) {
			if (task.getTaskClass() == null || !task.getTaskClass().startsWith(TASK_CLASS_PREFIX)) {
				continue;
			}
			if (!Boolean.TRUE.equals(task.getStarted()) && !Boolean.TRUE.equals(task.getStartOnStartup())) {
				continue;
			}
			try {
				// Saved first, so a shutdown that throws still leaves the task off at the next start.
				task.setStartOnStartup(false);
				scheduler.saveTaskDefinition(task);
				if (Boolean.TRUE.equals(task.getStarted())) {
					scheduler.shutdownTask(task);
				}
				log.info("Turned off labonfhir task '{}': the LIS integration is out of scope", task.getName());
				disabled++;
			}
			catch (Exception e) {
				log.error("Failed to turn off labonfhir task '{}'", task.getName(), e);
			}
		}
		return disabled;
	}
}
