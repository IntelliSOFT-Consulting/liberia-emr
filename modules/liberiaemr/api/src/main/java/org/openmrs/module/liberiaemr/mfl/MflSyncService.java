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

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.User;
import org.openmrs.api.context.Context;
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

	@Autowired
	private MflRunStore store;

	@Autowired
	private DbSessionFactory sessionFactory;

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

	public Map<String, Object> getLastRun() {
		return store.latest(null);
	}

	public Map<String, Object> getLastSuccessfulRun() {
		return store.latest(MflRunStore.STATUS_SUCCEEDED);
	}

	public Map<String, Object> getRunningRun() {
		return store.latest(MflRunStore.STATUS_RUNNING);
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
