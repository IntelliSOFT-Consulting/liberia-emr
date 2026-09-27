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

import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.User;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.type.TypeReference;

/**
 * The MFL run history: liberiaemr_mfl_sync_run and its items (liquibase.xml), read and written in
 * the shape the REST contract returns (docs/architecture/mfl-sync-api.md).
 */
@Component("liberiaemr.MflRunStore")
public class MflRunStore {

	public static final String STATUS_RUNNING = "RUNNING";

	public static final String STATUS_SUCCEEDED = "SUCCEEDED";

	public static final String STATUS_PARTIAL = "PARTIAL";

	public static final String STATUS_FAILED = "FAILED";

	private static final String RUN_COLUMNS = "r.run_id, r.dry_run, r.run_trigger, r.status, u.username, u.system_id, "
	        + "r.date_started, r.date_finished, r.created, r.updated, r.retired, r.unretired, r.unchanged, r.failed, "
	        + "r.warnings, r.message FROM liberiaemr_mfl_sync_run r LEFT JOIN users u ON u.user_id = r.started_by ";

	@Autowired
	private DbSessionFactory sessionFactory;

	/** @return the new run's id, in status RUNNING */
	@Transactional
	public int create(final boolean dryRun, final String trigger, final User startedBy, final Date started) {
		return work(new ReturningWork<Integer>() {

			@Override
			public Integer execute(Connection connection) throws SQLException {
				PreparedStatement insert = connection.prepareStatement(
				    "INSERT INTO liberiaemr_mfl_sync_run (dry_run, run_trigger, status, started_by, date_started, uuid) "
				            + "VALUES (?, ?, ?, ?, ?, ?)", Statement.RETURN_GENERATED_KEYS);
				try {
					insert.setBoolean(1, dryRun);
					insert.setString(2, trigger);
					insert.setString(3, STATUS_RUNNING);
					if (startedBy == null) {
						insert.setNull(4, java.sql.Types.INTEGER);
					} else {
						insert.setInt(4, startedBy.getUserId());
					}
					insert.setTimestamp(5, new Timestamp(started.getTime()));
					insert.setString(6, UUID.randomUUID().toString());
					insert.executeUpdate();
					ResultSet keys = insert.getGeneratedKeys();
					keys.next();
					return keys.getInt(1);
				}
				finally {
					insert.close();
				}
			}
		});
	}

	@Transactional
	public void addItems(final int runId, final List<MflRunItem> items) {
		work(new ReturningWork<Void>() {

			@Override
			public Void execute(Connection connection) throws SQLException {
				PreparedStatement insert = connection.prepareStatement("INSERT INTO liberiaemr_mfl_sync_run_item "
				        + "(run_id, action, location_level, mfl_uid, mfl_code, location_uuid, name, changes, warnings, error) "
				        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
				try {
					for (MflRunItem item : items) {
						List<Map<String, Object>> changes = new ArrayList<Map<String, Object>>();
						for (MflRunItem.Change change : item.getChanges()) {
							Map<String, Object> json = new LinkedHashMap<String, Object>();
							json.put("field", change.getField());
							json.put("from", change.getFrom());
							json.put("to", change.getTo());
							changes.add(json);
						}
						insert.setInt(1, runId);
						insert.setString(2, item.getAction().name());
						insert.setString(3, item.getLevel() == null ? null : item.getLevel().name());
						insert.setString(4, item.getMflUid());
						insert.setString(5, item.getMflCode());
						insert.setString(6, item.getLocationUuid());
						insert.setString(7, item.getName());
						insert.setString(8, toJson(changes));
						insert.setString(9, toJson(item.getWarnings()));
						insert.setString(10, truncate(item.getError(), 1000));
						insert.addBatch();
					}
					insert.executeBatch();
				}
				finally {
					insert.close();
				}
				return null;
			}
		});
	}

	/** @param counts null on a run that stopped before it counted anything */
	@Transactional
	public void finish(final int runId, final String status, final MflRunCounts counts, final String message,
	        final Date finished) {
		work(new ReturningWork<Void>() {

			@Override
			public Void execute(Connection connection) throws SQLException {
				MflRunCounts c = counts == null ? new MflRunCounts() : counts;
				PreparedStatement update = connection.prepareStatement("UPDATE liberiaemr_mfl_sync_run SET status = ?, "
				        + "date_finished = ?, created = ?, updated = ?, retired = ?, unretired = ?, unchanged = ?, "
				        + "failed = ?, warnings = ?, message = ? WHERE run_id = ?");
				try {
					update.setString(1, status);
					update.setTimestamp(2, new Timestamp(finished.getTime()));
					update.setInt(3, c.getCreated());
					update.setInt(4, c.getUpdated());
					update.setInt(5, c.getRetired());
					update.setInt(6, c.getUnretired());
					update.setInt(7, c.getUnchanged());
					update.setInt(8, c.getFailed());
					update.setInt(9, c.getWarnings());
					update.setString(10, truncate(message, 1000));
					update.setInt(11, runId);
					update.executeUpdate();
				}
				finally {
					update.close();
				}
				return null;
			}
		});
	}

	/**
	 * A run left RUNNING by a server that stopped mid-run can never finish; it is failed at start-up
	 * so it does not block the next one.
	 *
	 * @return how many were failed
	 */
	@Transactional
	public int failInterrupted(final Date now) {
		return work(new ReturningWork<Integer>() {

			@Override
			public Integer execute(Connection connection) throws SQLException {
				PreparedStatement update = connection.prepareStatement("UPDATE liberiaemr_mfl_sync_run SET status = ?, "
				        + "date_finished = ?, message = ? WHERE status = ?");
				try {
					update.setString(1, STATUS_FAILED);
					update.setTimestamp(2, new Timestamp(now.getTime()));
					update.setString(3, "Interrupted: the server stopped before the run finished");
					update.setString(4, STATUS_RUNNING);
					return update.executeUpdate();
				}
				finally {
					update.close();
				}
			}
		});
	}

	/** @return the run as the API's MflRun, or null */
	@Transactional(readOnly = true)
	public Map<String, Object> get(final int runId) {
		List<Map<String, Object>> runs = runs("WHERE r.run_id = ?", Collections.<Object> singletonList(runId), 0, 1);
		return runs.isEmpty() ? null : runs.get(0);
	}

	/** @return the newest run in the given status, or the newest of all when status is null */
	@Transactional(readOnly = true)
	public Map<String, Object> latest(String status) {
		List<Map<String, Object>> runs = status == null ? runs("", Collections.emptyList(), 0, 1) : runs(
		    "WHERE r.status = ?", Collections.<Object> singletonList(status), 0, 1);
		return runs.isEmpty() ? null : runs.get(0);
	}

	/** @return the newest run that has finished, whatever its outcome, or null */
	@Transactional(readOnly = true)
	public Map<String, Object> latestFinished() {
		List<Map<String, Object>> runs = runs("WHERE r.status <> ?", Collections.<Object> singletonList(STATUS_RUNNING), 0,
		    1);
		return runs.isEmpty() ? null : runs.get(0);
	}

	/** @return MflRunPage: results newest first, and totalCount */
	@Transactional(readOnly = true)
	public Map<String, Object> page(int startIndex, int limit) {
		Map<String, Object> page = new LinkedHashMap<String, Object>();
		page.put("results", runs("", Collections.emptyList(), startIndex, limit));
		page.put("totalCount", count("SELECT COUNT(*) FROM liberiaemr_mfl_sync_run", Collections.emptyList()));
		return page;
	}

	/** @return MflRunItemPage, or null when there is no such run */
	@Transactional(readOnly = true)
	public Map<String, Object> items(final int runId, final String action, final int startIndex, final int limit) {
		if (get(runId) == null) {
			return null;
		}
		final List<Object> params = new ArrayList<Object>();
		params.add(runId);
		String where = " WHERE run_id = ?";
		if (action != null) {
			where += " AND action = ?";
			params.add(action);
		}
		final String sql = "SELECT action, location_level, mfl_uid, mfl_code, location_uuid, name, changes, warnings, error "
		        + "FROM liberiaemr_mfl_sync_run_item" + where + " ORDER BY item_id LIMIT " + limit + " OFFSET " + startIndex;
		List<Map<String, Object>> results = work(new ReturningWork<List<Map<String, Object>>>() {

			@Override
			public List<Map<String, Object>> execute(Connection connection) throws SQLException {
				List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
				PreparedStatement select = prepare(connection, sql, params);
				try {
					ResultSet rows = select.executeQuery();
					while (rows.next()) {
						Map<String, Object> item = new LinkedHashMap<String, Object>();
						item.put("action", rows.getString("action"));
						item.put("level", rows.getString("location_level"));
						item.put("mflUid", rows.getString("mfl_uid"));
						item.put("mflCode", rows.getString("mfl_code"));
						item.put("locationUuid", rows.getString("location_uuid"));
						item.put("name", rows.getString("name"));
						item.put("changes", fromJson(rows.getString("changes"),
						    new TypeReference<List<Map<String, Object>>>() {}));
						item.put("warnings", fromJson(rows.getString("warnings"), new TypeReference<List<String>>() {}));
						item.put("error", rows.getString("error"));
						out.add(item);
					}
				}
				finally {
					select.close();
				}
				return out;
			}
		});
		Map<String, Object> page = new LinkedHashMap<String, Object>();
		page.put("results", results);
		page.put("totalCount", count("SELECT COUNT(*) FROM liberiaemr_mfl_sync_run_item" + where, params));
		return page;
	}

	private List<Map<String, Object>> runs(String where, final List<Object> params, int startIndex, int limit) {
		final String sql = "SELECT " + RUN_COLUMNS + where + " ORDER BY r.run_id DESC LIMIT " + limit + " OFFSET "
		        + startIndex;
		return work(new ReturningWork<List<Map<String, Object>>>() {

			@Override
			public List<Map<String, Object>> execute(Connection connection) throws SQLException {
				List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
				PreparedStatement select = prepare(connection, sql, params);
				try {
					ResultSet rows = select.executeQuery();
					while (rows.next()) {
						out.add(run(rows));
					}
				}
				finally {
					select.close();
				}
				return out;
			}
		});
	}

	private static Map<String, Object> run(ResultSet rows) throws SQLException {
		Map<String, Object> run = new LinkedHashMap<String, Object>();
		run.put("id", rows.getInt("run_id"));
		run.put("dryRun", rows.getBoolean("dry_run"));
		run.put("trigger", rows.getString("run_trigger"));
		run.put("status", rows.getString("status"));
		String username = rows.getString("username");
		run.put("startedBy", username != null && !username.isEmpty() ? username : rows.getString("system_id"));
		run.put("started", millis(rows.getTimestamp("date_started")));
		run.put("finished", millis(rows.getTimestamp("date_finished")));
		Map<String, Object> counts = new LinkedHashMap<String, Object>();
		for (String column : new String[] { "created", "updated", "retired", "unretired", "unchanged", "failed",
		        "warnings" }) {
			counts.put(column, rows.getInt(column));
		}
		run.put("counts", counts);
		run.put("message", rows.getString("message"));
		return run;
	}

	private int count(final String sql, final List<Object> params) {
		return work(new ReturningWork<Integer>() {

			@Override
			public Integer execute(Connection connection) throws SQLException {
				PreparedStatement select = prepare(connection, sql, params);
				try {
					ResultSet rows = select.executeQuery();
					rows.next();
					return rows.getInt(1);
				}
				finally {
					select.close();
				}
			}
		});
	}

	private static PreparedStatement prepare(Connection connection, String sql, List<Object> params) throws SQLException {
		PreparedStatement statement = connection.prepareStatement(sql);
		for (int i = 0; i < params.size(); i++) {
			statement.setObject(i + 1, params.get(i));
		}
		return statement;
	}

	private <T> T work(ReturningWork<T> work) {
		return sessionFactory.getCurrentSession().doReturningWork(work);
	}

	private static Long millis(Timestamp timestamp) {
		return timestamp == null ? null : timestamp.getTime();
	}

	private static String truncate(String value, int max) {
		return value == null || value.length() <= max ? value : value.substring(0, max - 1) + "…";
	}

	private static String toJson(Object value) {
		try {
			return MflUnit.JSON.writeValueAsString(value);
		}
		catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}

	private static <T> T fromJson(String json, TypeReference<T> type) {
		if (json == null) {
			return null;
		}
		try {
			return MflUnit.JSON.readValue(json, type);
		}
		catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}
}
