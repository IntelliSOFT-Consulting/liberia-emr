/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.programs;

import java.util.Date;
import java.util.concurrent.atomic.AtomicBoolean;

import org.openmrs.api.context.Context;
import org.openmrs.scheduler.SchedulerService;
import org.openmrs.scheduler.TaskDefinition;
import org.openmrs.scheduler.tasks.AbstractTask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs {@link ProgramAutoClose} hourly at a facility. Central skips it: an enrolment is closed
 * where it was recorded, and the change syncs up.
 */
public class ProgramAutoCloseTask extends AbstractTask {

	public static final String NAME = "LiberiaEMR Programme Auto-Close";

	static final long INTERVAL_SECONDS = 3600;

	static final String INSTANCE_ROLE_VARIABLE = "LIBERIAEMR_INSTANCE_ROLE";

	private static final Logger log = LoggerFactory.getLogger(ProgramAutoCloseTask.class);

	private static final AtomicBoolean RUNNING = new AtomicBoolean();

	@Override
	public void execute() {
		if (isCentral(System.getenv(INSTANCE_ROLE_VARIABLE)) || !RUNNING.compareAndSet(false, true)) {
			return;
		}
		try {
			int closed = new ProgramAutoClose().run();
			if (closed > 0) {
				log.info("Programme auto-close: completed {} enrolment(s)", closed);
			}
		}
		catch (Exception e) {
			log.error("Programme auto-close failed", e);
		}
		finally {
			RUNNING.set(false);
		}
	}

	static boolean isCentral(String role) {
		return role != null && "central".equalsIgnoreCase(role.trim());
	}

	/** Creates the task on first start. */
	public static void schedule() {
		try {
			SchedulerService scheduler = Context.getSchedulerService();
			if (scheduler.getTaskByName(NAME) != null) {
				return;
			}
			TaskDefinition task = new TaskDefinition();
			task.setName(NAME);
			task.setDescription("Completes programme enrolments once a closing encounter is recorded (liberiaemr.programs.autoCloseRules)");
			task.setTaskClass(ProgramAutoCloseTask.class.getName());
			task.setStartTime(new Date());
			task.setRepeatInterval(INTERVAL_SECONDS);
			task.setStartOnStartup(true);
			task.setStarted(true);
			scheduler.saveTaskDefinition(task);
			scheduler.scheduleTask(task);
			log.info("Programme auto-close task scheduled every {}s", INTERVAL_SECONDS);
		}
		catch (Exception e) {
			log.error("Failed to schedule the programme auto-close task", e);
		}
	}
}
