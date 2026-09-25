/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr;

import java.util.Date;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.api.context.Context;
import org.openmrs.module.BaseModuleActivator;
import org.openmrs.module.DaemonToken;
import org.openmrs.module.DaemonTokenAware;
import org.openmrs.module.liberiaemr.identity.IdentityAssignmentTask;
import org.openmrs.scheduler.SchedulerService;
import org.openmrs.scheduler.TaskDefinition;

/**
 * This class contains the logic that is run every time this module is either started or shutdown
 */
public class LiberiaEMRActivator extends BaseModuleActivator implements DaemonTokenAware {

	private Log log = LogFactory.getLog(this.getClass());

	private static DaemonToken daemonToken;

	/**
	 * Called by OpenMRS to supply a daemon token that allows event listeners to run privileged
	 * background tasks without username/password credentials.
	 */
	@Override
	public void setDaemonToken(DaemonToken token) {
		daemonToken = token;
		log.info("LiberiaEMR: daemon token received");
	}

	public static DaemonToken getDaemonToken() {
		return daemonToken;
	}

	/**
	 * @see #started()
	 */
	public void started() {
		log.info("Started LiberiaEMR");
		try {
			org.openmrs.event.Event.subscribe(
			    org.openmrs.Obs.class,
			    org.openmrs.event.Event.Action.CREATED.name(),
			    org.openmrs.api.context.Context.getRegisteredComponents(
			        org.openmrs.module.liberiaemr.api.listener.NextContactDateEventListener.class).get(0));
		}
		catch (Exception e) {
			log.error("Failed to subscribe to Obs CREATED event", e);
		}
		scheduleIdentityTask();
	}

	/**
	 * Registers the identity task once; the scheduler keeps it across restarts. The task does
	 * nothing on a server without the identity schema, so every facility carries it harmlessly.
	 */
	private void scheduleIdentityTask() {
		try {
			SchedulerService scheduler = Context.getSchedulerService();
			TaskDefinition task = scheduler.getTaskByName(IdentityAssignmentTask.NAME);
			if (task == null) {
				task = new TaskDefinition();
				task.setName(IdentityAssignmentTask.NAME);
				task.setDescription("Mints a Central Person Identifier for each patient central receives and links records on National ID");
				task.setTaskClass(IdentityAssignmentTask.class.getName());
				task.setStartTime(new Date());
				task.setRepeatInterval(60L);
				task.setStartOnStartup(true);
				task.setStarted(true);
				scheduler.saveTaskDefinition(task);
				scheduler.scheduleTask(task);
				log.info("LiberiaEMR: identity task scheduled");
			}
		}
		catch (Exception e) {
			log.error("Failed to schedule the identity task", e);
		}
	}

	/**
	 * @see #shutdown()
	 */
	public void shutdown() {
		log.info("Shutdown LiberiaEMR");
		try {
			org.openmrs.event.Event.unsubscribe(
			    org.openmrs.Obs.class,
			    org.openmrs.event.Event.Action.CREATED,
			    org.openmrs.api.context.Context.getRegisteredComponents(
			        org.openmrs.module.liberiaemr.api.listener.NextContactDateEventListener.class).get(0));
		}
		catch (Exception e) {
			log.error("Failed to unsubscribe from Obs CREATED event", e);
		}
	}

}
