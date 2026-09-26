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

import java.util.Date;

import org.openmrs.GlobalProperty;
import org.openmrs.api.GlobalPropertyListener;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.module.DaemonToken;
import org.openmrs.scheduler.SchedulerService;
import org.openmrs.scheduler.TaskDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Keeps the identity task's interval equal to liberiaemr.identity.intervalSeconds, whether the
 * value comes from Initializer at startup or is edited later.
 */
public class IdentitySchedule implements GlobalPropertyListener {

	public static final String GP_INTERVAL_SECONDS = "liberiaemr.identity.intervalSeconds";

	static final long DEFAULT_SECONDS = 60;

	static final long MIN_SECONDS = 10;

	private static final Logger log = LoggerFactory.getLogger(IdentitySchedule.class);

	private final DaemonToken daemonToken;

	public IdentitySchedule(DaemonToken daemonToken) {
		this.daemonToken = daemonToken;
	}

	/** Creates the task on first start, or moves it to the configured interval. */
	public static void apply(String configured) {
		long seconds = seconds(configured);
		try {
			SchedulerService scheduler = Context.getSchedulerService();
			TaskDefinition task = scheduler.getTaskByName(IdentityAssignmentTask.NAME);
			if (task == null) {
				task = new TaskDefinition();
				task.setName(IdentityAssignmentTask.NAME);
				task.setDescription("Mints a Central Person Identifier for each patient central receives and links records on National ID");
				task.setTaskClass(IdentityAssignmentTask.class.getName());
				task.setStartTime(new Date());
				task.setRepeatInterval(seconds);
				task.setStartOnStartup(true);
				task.setStarted(true);
				scheduler.saveTaskDefinition(task);
				scheduler.scheduleTask(task);
				log.info("Identity task scheduled every {}s", seconds);
			} else if (task.getRepeatInterval() == null || task.getRepeatInterval() != seconds) {
				task.setRepeatInterval(seconds);
				scheduler.rescheduleTask(task);
				log.info("Identity task now runs every {}s", seconds);
			}
		}
		catch (Exception e) {
			log.error("Failed to schedule the identity task", e);
		}
	}

	static long seconds(String configured) {
		try {
			return configured == null || configured.trim().isEmpty() ? DEFAULT_SECONDS
			        : Math.max(MIN_SECONDS, Long.parseLong(configured.trim()));
		}
		catch (NumberFormatException e) {
			log.warn("{} is '{}', not a number; using {}", GP_INTERVAL_SECONDS, configured, DEFAULT_SECONDS);
			return DEFAULT_SECONDS;
		}
	}

	@Override
	public boolean supportsPropertyName(String propertyName) {
		return GP_INTERVAL_SECONDS.equals(propertyName);
	}

	// The saving user may lack Manage Scheduler, and the new value is not committed yet, so it is
	// passed in and applied as the daemon.
	@Override
	public void globalPropertyChanged(final GlobalProperty property) {
		final String value = property.getPropertyValue();
		Daemon.runInDaemonThreadAndWait(new Runnable() {

			@Override
			public void run() {
				apply(value);
			}
		}, daemonToken);
	}

	@Override
	public void globalPropertyDeleted(String propertyName) {
		Daemon.runInDaemonThreadAndWait(new Runnable() {

			@Override
			public void run() {
				apply(null);
			}
		}, daemonToken);
	}
}
