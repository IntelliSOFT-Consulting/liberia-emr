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

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.api.context.Context;
import org.openmrs.module.BaseModuleActivator;
import org.openmrs.module.DaemonToken;
import org.openmrs.module.DaemonTokenAware;
import org.openmrs.module.liberiaemr.identity.IdentitySchedule;
import org.openmrs.module.liberiaemr.lab.LabOnFhirTasks;
import org.openmrs.module.liberiaemr.mfl.MflSchedule;
import org.openmrs.module.liberiaemr.mfl.MflSettings;
import org.openmrs.module.liberiaemr.mfl.MflSyncService;

/**
 * This class contains the logic that is run every time this module is either started or shutdown
 */
public class LiberiaEMRActivator extends BaseModuleActivator implements DaemonTokenAware {

	private Log log = LogFactory.getLog(this.getClass());

	private static DaemonToken daemonToken;

	private IdentitySchedule identitySchedule;

	private MflSchedule mflSchedule;

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
		org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessInstaller.install();
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
		scheduleMflTask();
		LabOnFhirTasks.apply();
	}

	/**
	 * Schedules the identity task at liberiaemr.identity.intervalSeconds and follows later changes
	 * to it. The task does nothing on a server without the identity schema, so every facility
	 * carries it harmlessly.
	 */
	private void scheduleIdentityTask() {
		IdentitySchedule.apply(Context.getAdministrationService().getGlobalProperty(IdentitySchedule.GP_INTERVAL_SECONDS));
		identitySchedule = new IdentitySchedule(daemonToken);
		Context.getAdministrationService().addGlobalPropertyListener(identitySchedule);
	}

	/**
	 * Schedules the daily MFL sync at liberiaemr.mfl.schedule.time and follows later changes to it
	 * (ADR 0009). The task does nothing where the sync is disabled or has no credentials, so every
	 * instance carries it harmlessly. A run a stopped server left RUNNING is failed first, so it
	 * cannot block the next.
	 */
	private void scheduleMflTask() {
		try {
			Context.getRegisteredComponent("liberiaemr.MflSyncService", MflSyncService.class).failInterruptedRuns();
		}
		catch (Exception e) {
			log.error("Failed to close MFL sync runs a stopped server left running", e);
		}
		MflSchedule.apply(Context.getAdministrationService().getGlobalProperty(MflSettings.GP_SCHEDULE_TIME));
		mflSchedule = new MflSchedule(daemonToken);
		Context.getAdministrationService().addGlobalPropertyListener(mflSchedule);
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
		if (identitySchedule != null) {
			Context.getAdministrationService().removeGlobalPropertyListener(identitySchedule);
		}
		if (mflSchedule != null) {
			Context.getAdministrationService().removeGlobalPropertyListener(mflSchedule);
		}
	}

}
