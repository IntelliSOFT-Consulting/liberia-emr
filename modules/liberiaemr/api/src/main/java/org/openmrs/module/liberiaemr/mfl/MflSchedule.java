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

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
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
 * Keeps the MFL task daily at liberiaemr.mfl.schedule.time, whether the value is the default or
 * edited later over REST. The OpenMRS scheduler repeats from the start time, so moving the start
 * time moves every later run.
 */
public class MflSchedule implements GlobalPropertyListener {

	static final long DAY_SECONDS = 24L * 60 * 60;

	private static final Logger log = LoggerFactory.getLogger(MflSchedule.class);

	private final DaemonToken daemonToken;

	public MflSchedule(DaemonToken daemonToken) {
		this.daemonToken = daemonToken;
	}

	/** Creates the task on first start, or moves it to the configured time of day. */
	public static void apply(String configured) {
		String time = MflSettings.time(configured);
		Date start = new Date(MflSettings.nextRun(time, System.currentTimeMillis()));
		try {
			SchedulerService scheduler = Context.getSchedulerService();
			TaskDefinition task = scheduler.getTaskByName(MflSyncTask.NAME);
			if (task == null) {
				task = new TaskDefinition();
				task.setName(MflSyncTask.NAME);
				task.setDescription("Pulls the MOH Master Facility List into locations (ADR 0009). Runs only while "
				        + MflSettings.GP_ENABLED + " is true and MFL credentials are configured");
				task.setTaskClass(MflSyncTask.class.getName());
				task.setStartTime(start);
				task.setRepeatInterval(DAY_SECONDS);
				task.setStartOnStartup(true);
				task.setStarted(true);
				scheduler.saveTaskDefinition(task);
				scheduler.scheduleTask(task);
				log.info("MFL sync task scheduled daily at {} ({})", time, MflSettings.ZONE);
			} else if (!runsAt(task.getStartTime(), time) || task.getRepeatInterval() == null
			        || task.getRepeatInterval() != DAY_SECONDS) {
				task.setStartTime(start);
				task.setRepeatInterval(DAY_SECONDS);
				scheduler.rescheduleTask(task);
				log.info("MFL sync task now runs daily at {} ({})", time, MflSettings.ZONE);
			}
		}
		catch (Exception e) {
			log.error("Failed to schedule the MFL sync task", e);
		}
	}

	/** @return whether a start time falls at HH:MM in Monrovia, on any day */
	static boolean runsAt(Date start, String time) {
		if (start == null) {
			return false;
		}
		return DateTimeFormatter.ofPattern("HH:mm").format(ZonedDateTime.ofInstant(start.toInstant(), MflSettings.ZONE))
		        .equals(time);
	}

	@Override
	public boolean supportsPropertyName(String propertyName) {
		return MflSettings.GP_SCHEDULE_TIME.equals(propertyName);
	}

	// The saving user holds Manage MFL Sync, not Manage Scheduler, so the change is applied as the
	// daemon, with the new value passed in because it is not committed yet.
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
