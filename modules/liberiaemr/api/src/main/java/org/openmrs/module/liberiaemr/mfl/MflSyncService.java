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

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.User;
import org.openmrs.api.AdministrationService;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.module.liberiaemr.LiberiaEMRActivator;
import org.openmrs.util.PrivilegeConstants;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Runs the MFL sync (ADR 0009) and keeps its history. One run: record it, pull the MFL, apply it
 * with the engine, record the items and the outcome. A run that cannot finish is recorded as
 * FAILED with a message an administrator can act on.
 * <p>
 * {@link #runNow} is deliberately not transactional: each location is saved in its own
 * transaction, so one bad row cannot roll back a thousand good ones.
 */
@Component("liberiaemr.MflSyncService")
public class MflSyncService {

	public static final String TRIGGER_MANUAL = "MANUAL";

	public static final String TRIGGER_SCHEDULE = "SCHEDULE";

	private static final Logger log = LoggerFactory.getLogger(MflSyncService.class);

	/** The sync has no credentials on this instance (REST 503). */
	public static class UnavailableException extends RuntimeException {

		public UnavailableException() {
			super("MFL credentials are not configured on this instance");
		}
	}

	/** A run is already going (REST 409): runs never overlap and are not queued. */
	public static class BusyException extends RuntimeException {

		private final Integer runId;

		public BusyException(Integer runId) {
			super("A run is already in progress");
			this.runId = runId;
		}

		public Integer getRunId() {
			return runId;
		}
	}

	/** Runs a manual run in the background, as the daemon, with a session of its own. */
	private static final Executor DAEMON = new Executor() {

		@Override
		public void execute(Runnable command) {
			Daemon.runInDaemonThread(command, LiberiaEMRActivator.getDaemonToken());
		}
	};

	@Autowired
	private MflRunStore store;

	@Autowired
	private DbSessionFactory sessionFactory;

	/** The run in progress: 0 for none, -1 while one is being recorded, else its id. */
	private final AtomicInteger running = new AtomicInteger();

	private Map<String, String> environment = System.getenv();

	private Executor executor = DAEMON;

	private MflSource sourceOverride;

	/**
	 * Runs one sync to the end in the calling thread.
	 *
	 * @param startedBy null for a scheduled run
	 * @return the run's id
	 */
	public int runNow(MflSource source, boolean dryRun, String trigger, User startedBy) {
		int runId = store.create(dryRun, trigger, startedBy, new Date());
		execute(runId, source, dryRun);
		return runId;
	}

	/** Runs an already recorded run to the end; the record says how it went. */
	public void execute(int runId, MflSource source, boolean dryRun) {
		try {
			MflSnapshot snapshot = source.fetch();
			MflSyncEngine.Result result = new MflSyncEngine(Context.getLocationService()).run(snapshot, dryRun, new Date());
			store.addItems(runId, result.getItems());
			MflRunCounts counts = result.getCounts();
			String status = MflRunStore.STATUS_SUCCEEDED;
			String message = result.getMessage();
			if (counts.getFailed() > 0) {
				status = MflRunStore.STATUS_PARTIAL;
				String failed = counts.getFailed() + " location(s) could not be applied; see the ERROR items";
				message = message == null ? failed : message + ". " + failed;
			} else if (result.isRetirementSkipped()) {
				status = MflRunStore.STATUS_PARTIAL;
			}
			store.finish(runId, status, counts, message, new Date());
			log.info("MFL sync run {} {}{}: {}", runId, status, dryRun ? " (dry run)" : "", counts.toMap());
		}
		catch (MflException e) {
			log.warn("MFL sync run {} failed: {}", runId, e.getMessage());
			store.finish(runId, MflRunStore.STATUS_FAILED, null, e.getMessage(), new Date());
		}
		catch (RuntimeException e) {
			log.error("MFL sync run " + runId + " stopped", e);
			store.finish(runId, MflRunStore.STATUS_FAILED, null, "The run stopped: " + e.getClass().getSimpleName()
			        + (e.getMessage() == null ? "" : ": " + e.getMessage()), new Date());
		}
	}

	public Map<String, Object> getRun(int runId) {
		return store.get(runId);
	}

	public Map<String, Object> getRuns(int startIndex, int limit) {
		return store.page(startIndex, limit);
	}

	/** @return MflRunItemPage, or null when there is no such run */
	public Map<String, Object> getItems(int runId, String action, int startIndex, int limit) {
		return store.items(runId, action, startIndex, limit);
	}

	/** @return the newest finished run, whatever its outcome, or null */
	public Map<String, Object> getLastRun() {
		return store.latestFinished();
	}

	public Map<String, Object> getLastSuccessfulRun() {
		return store.latest(MflRunStore.STATUS_SUCCEEDED);
	}

	public Map<String, Object> getRunningRun() {
		return store.latest(MflRunStore.STATUS_RUNNING);
	}

	/** The sync is available where both MFL credentials are configured (ADR 0009 decision 2). */
	public boolean isAvailable() {
		return MflCredentials.fromEnvironment(environment).isAvailable();
	}

	/** @return MflStatus (docs/architecture/mfl-sync-api.md); it never carries the password */
	public Map<String, Object> getStatus() {
		AdministrationService admin = Context.getAdministrationService();
		boolean enabled = MflSettings.enabled(admin.getGlobalProperty(MflSettings.GP_ENABLED));
		String time = MflSettings.time(admin.getGlobalProperty(MflSettings.GP_SCHEDULE_TIME));
		Map<String, Object> schedule = new LinkedHashMap<String, Object>();
		schedule.put("time", time);
		Map<String, Object> config = new LinkedHashMap<String, Object>();
		config.put("enabled", enabled);
		config.put("url", MflSettings.displayUrl(admin.getGlobalProperty(MflSettings.GP_URL)));
		config.put("username", MflCredentials.fromEnvironment(environment).getUsername());
		config.put("schedule", schedule);

		Map<String, Object> status = new LinkedHashMap<String, Object>();
		status.put("available", isAvailable());
		status.put("config", config);
		status.put("nextRun", enabled ? MflSettings.nextRun(time, System.currentTimeMillis()) : null);
		status.put("running", getRunningRun());
		status.put("lastRun", getLastRun());
		status.put("lastSuccessfulRun", getLastSuccessfulRun());
		status.put("held", getHeld());
		return status;
	}

	/**
	 * Saves a partial config. Every field is checked before any is saved.
	 *
	 * @return the status after the change
	 * @throws IllegalArgumentException when a field is invalid (REST 400)
	 */
	public Map<String, Object> updateConfig(Map<String, Object> body) {
		Map<String, String> properties = MflSettings.validate(body, MflEndpointPolicy.fromEnvironment(environment));
		// Manage MFL Sync is the privilege this takes; saving its own settings is part of it.
		Context.addProxyPrivilege(PrivilegeConstants.MANAGE_GLOBAL_PROPERTIES);
		Context.addProxyPrivilege(PrivilegeConstants.GET_GLOBAL_PROPERTIES);
		try {
			for (Map.Entry<String, String> property : properties.entrySet()) {
				Context.getAdministrationService().setGlobalProperty(property.getKey(), property.getValue());
			}
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.MANAGE_GLOBAL_PROPERTIES);
			Context.removeProxyPrivilege(PrivilegeConstants.GET_GLOBAL_PROPERTIES);
		}
		return getStatus();
	}

	/**
	 * @return MflConnectionTest: a refused or unreachable MFL is an answer, not an error
	 * @throws UnavailableException without credentials
	 */
	public Map<String, Object> testConnection() {
		if (!isAvailable()) {
			throw new UnavailableException();
		}
		return client().testConnection();
	}

	/**
	 * Starts a manual run in the background.
	 *
	 * @return the run as it started, in status RUNNING
	 * @throws UnavailableException without credentials
	 * @throws BusyException while another run is going
	 */
	public Map<String, Object> startRun(final boolean dryRun, User startedBy) {
		if (!isAvailable()) {
			throw new UnavailableException();
		}
		if (!running.compareAndSet(0, -1)) {
			throw new BusyException(currentRunId());
		}
		final int runId;
		try {
			runId = store.create(dryRun, TRIGGER_MANUAL, startedBy, new Date());
		}
		catch (RuntimeException e) {
			running.set(0);
			throw e;
		}
		running.set(runId);
		Map<String, Object> run = store.get(runId);
		final MflSource source = source();
		executor.execute(new Runnable() {

			@Override
			public void run() {
				try {
					execute(runId, source, dryRun);
				}
				finally {
					running.set(0);
				}
			}
		});
		return run;
	}

	/**
	 * The daily run (MflSyncTask). It does nothing while the sync is disabled or unavailable, or
	 * while a manual run is going.
	 */
	public void runScheduled() {
		if (!MflSettings.enabled(Context.getAdministrationService().getGlobalProperty(MflSettings.GP_ENABLED))) {
			return;
		}
		if (!isAvailable()) {
			log.warn("The MFL sync is enabled but has no credentials on this instance; the scheduled run is skipped");
			return;
		}
		if (!running.compareAndSet(0, -1)) {
			log.info("The scheduled MFL sync is skipped: run {} is still going", currentRunId());
			return;
		}
		try {
			int runId = store.create(false, TRIGGER_SCHEDULE, null, new Date());
			running.set(runId);
			execute(runId, source(), false);
		}
		finally {
			running.set(0);
		}
	}

	/** Fails any run a stopped server left RUNNING; called at module start. */
	public void failInterruptedRuns() {
		int failed = store.failInterrupted(new Date());
		if (failed > 0) {
			log.warn("{} MFL sync run(s) were left running by a server that stopped; marked FAILED", failed);
		}
	}

	private Integer currentRunId() {
		int id = running.get();
		if (id > 0) {
			return id;
		}
		Map<String, Object> run = getRunningRun();
		return run == null ? null : (Integer) run.get("id");
	}

	private MflSource source() {
		return sourceOverride != null ? sourceOverride : client();
	}

	private MflClient client() {
		return new MflClient(MflSettings.url(Context.getAdministrationService().getGlobalProperty(MflSettings.GP_URL)),
		        MflCredentials.fromEnvironment(environment), MflEndpointPolicy.fromEnvironment(environment),
		        MflClient.PAGE_SIZE, 2000);
	}

	// For tests: the environment, the executor and the MFL itself are the three things a test
	// cannot let the service reach for real. Public because the bean is a transactional proxy,
	// which forwards only public methods to the real instance.

	public void setEnvironment(Map<String, String> environment) {
		this.environment = environment;
	}

	public void setExecutor(Executor executor) {
		this.executor = executor;
	}

	public void setSource(MflSource source) {
		this.sourceOverride = source;
	}

	public void reset() {
		environment = System.getenv();
		executor = DAEMON;
		sourceOverride = null;
		running.set(0);
	}

	/**
	 * @return counties, districts and facilities: the non-retired locations here that carry an MFL
	 *         UID, by level tag; retired: those retired
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> getHeld() {
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				PreparedStatement select = connection.prepareStatement("SELECT l.location_id, l.retired, t.name "
				        + "FROM location l JOIN location_attribute a ON a.location_id = l.location_id AND a.voided = 0 "
				        + "JOIN location_attribute_type at ON at.location_attribute_type_id = a.attribute_type_id "
				        + "AND at.uuid = ? LEFT JOIN location_tag_map m ON m.location_id = l.location_id "
				        + "LEFT JOIN location_tag t ON t.location_tag_id = m.location_tag_id AND t.name IN (?, ?, ?)");
				Map<Integer, Boolean> retired = new HashMap<Integer, Boolean>();
				Map<Integer, String> levels = new HashMap<Integer, String>();
				try {
					select.setString(1, MflConstants.ATTR_MFL_UID);
					select.setString(2, MflConstants.TAG_COUNTY);
					select.setString(3, MflConstants.TAG_DISTRICT);
					select.setString(4, MflConstants.TAG_HEALTH_FACILITY);
					ResultSet rows = select.executeQuery();
					while (rows.next()) {
						retired.put(rows.getInt(1), rows.getBoolean(2));
						if (rows.getString(3) != null) {
							levels.put(rows.getInt(1), rows.getString(3));
						}
					}
				}
				finally {
					select.close();
				}
				int counties = 0, districts = 0, facilities = 0, retiredCount = 0;
				for (Map.Entry<Integer, Boolean> location : retired.entrySet()) {
					if (location.getValue()) {
						retiredCount++;
						continue;
					}
					String level = levels.get(location.getKey());
					if (MflConstants.TAG_COUNTY.equals(level)) {
						counties++;
					} else if (MflConstants.TAG_DISTRICT.equals(level)) {
						districts++;
					} else {
						facilities++;
					}
				}
				Map<String, Object> held = new LinkedHashMap<String, Object>();
				held.put("counties", counties);
				held.put("districts", districts);
				held.put("facilities", facilities);
				held.put("retired", retiredCount);
				return held;
			}
		});
	}
}
