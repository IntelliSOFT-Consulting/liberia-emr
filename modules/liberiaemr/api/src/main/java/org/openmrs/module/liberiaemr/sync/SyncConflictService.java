/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.sync;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.hibernate.HibernateException;
import org.hibernate.jdbc.ReturningWork;
import org.openmrs.User;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The sync conflicts waiting at central, and the decisions reviewers record on them.
 *
 * A conflict is a facility's update that dbsync held back because central's copy of the record
 * was changed outside sync. The conflict itself lives in the receiver's management schema,
 * which the EMR's database account can only read. The decision is written here, in the EMR's own
 * table, and the receiver applies decided conflicts in its nightly window with dbsync's hash
 * updater (distribution/sync/conflict-decisions.sh). The two sides never write to each other's
 * tables, except the receiver stamping a decision as applied.
 *
 * Off unless the management schema is named, which is how a facility behaves: it runs the same
 * module and has no receiver.
 */
@Component("liberiaemr.SyncConflictService")
public class SyncConflictService {

	private static final Logger log = LoggerFactory.getLogger(SyncConflictService.class);

	public static final String ENV_MGMT_SCHEMA = "LIBERIAEMR_SYNC_MGMT_DB_NAME";

	public static final String ENV_APPLY_WINDOW = "LIBERIAEMR_SYNC_CONFLICT_WINDOW";

	/** The facility's version is right; central's change is overwritten. */
	public static final String FACILITY_STANDS = "FACILITY_STANDS";

	/** Central's change is right and the facility will make it too; until then the facility's version applies. */
	public static final String CENTRAL_REDONE_AT_FACILITY = "CENTRAL_REDONE_AT_FACILITY";

	public static final List<String> DECISIONS = Collections
	        .unmodifiableList(Arrays.asList(FACILITY_STANDS, CENTRAL_REDONE_AT_FACILITY));

	public static final int REASON_MAX_LENGTH = 500;

	/** How long an applied decision stays in the page's recent list; the table keeps it for good. */
	private static final int RECENT_DAYS = 30;

	private static final Pattern SCHEMA_NAME = Pattern.compile("^[A-Za-z0-9_]+$");

	private static final Pattern IDENTIFIER = Pattern.compile("^[a-z0-9_]+$");

	/** The conflict does not exist, or no longer does: it was applied and removed. */
	public static class NotFoundException extends RuntimeException {

		public NotFoundException(String message) {
			super(message);
		}
	}

	/** The conflict under that id is not the record the reviewer looked at. */
	public static class StaleException extends RuntimeException {

		public StaleException(String message) {
			super(message);
		}
	}

	@Autowired
	private DbSessionFactory sessionFactory;

	private final ObjectMapper mapper = new ObjectMapper();

	/**
	 * @return true where there is a receiver to review conflicts for
	 */
	public boolean isEnabled() {
		return schema() != null;
	}

	/**
	 * @return the queued conflicts with the latest decision on each, and decisions applied lately
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> list() {
		final String schema = schema();
		final Map<String, Object> result = new LinkedHashMap<String, Object>();
		result.put("enabled", schema != null);
		if (schema == null) {
			return result;
		}
		result.put("applyWindow", applyWindow());

		try {
			readQueue(schema, result);
			result.put("available", true);
		}
		catch (HibernateException e) {
			// Typically a central database older than the grant that lets the EMR read the
			// receiver's schema (distribution/compose/central/initdb). Say so; do not fail.
			log.warn("Cannot read the sync receiver's conflict queue: {}", e.getMessage());
			result.put("available", false);
		}
		return result;
	}

	private void readQueue(final String schema, final Map<String, Object> result) {
		sessionFactory.getCurrentSession().doWork(connection -> {
			List<Map<String, Object>> rows = query(connection, "SELECT c.id, c.model_class_name, c.identifier, "
			        + "c.date_created, (SELECT COUNT(*) FROM `" + schema + "`.receiver_retry_queue r "
			        + "WHERE r.identifier = c.identifier) AS waiting FROM `" + schema
			        + "`.receiver_conflict_queue c ORDER BY c.id");
			Map<Long, Map<String, Object>> latest = latestDecisions(connection);

			Map<String, Integer> undecided = new HashMap<String, Integer>();
			List<Map<String, Object>> conflicts = new ArrayList<Map<String, Object>>();
			for (Map<String, Object> row : rows) {
				long id = ((Number) row.get("id")).longValue();
				String table = SyncConflictTables.tableOf((String) row.get("model_class_name"));
				Map<String, Object> decision = latest.get(id);
				if (decision != null && !row.get("identifier").equals(decision.get("identifier"))) {
					decision = null;
				}
				if (decision == null) {
					undecided.merge(String.valueOf(table), 1, Integer::sum);
				}

				Map<String, Object> conflict = new LinkedHashMap<String, Object>();
				conflict.put("id", id);
				conflict.put("table", table);
				conflict.put("identifier", row.get("identifier"));
				conflict.put("raised", millis(row.get("date_created")));
				conflict.put("waiting", ((Number) row.get("waiting")).intValue());
				conflict.put("decision", decision == null ? null : describe(decision));
				conflicts.add(conflict);
			}
			// A table is rebuilt only once every conflict in it is decided (dbsync's hash updater
			// refuses otherwise), so a decided conflict can be waiting on someone else's.
			for (Map<String, Object> conflict : conflicts) {
				Integer others = undecided.get(String.valueOf(conflict.get("table")));
				int count = others == null ? 0 : others;
				conflict.put("undecidedInTable", conflict.get("decision") == null ? count - 1 : count);
			}
			result.put("conflicts", conflicts);

			List<Map<String, Object>> recent = new ArrayList<Map<String, Object>>();
			for (Map<String, Object> row : query(connection, "SELECT d.*, u.username FROM liberiaemr_sync_conflict_decision d "
			        + "LEFT JOIN users u ON u.user_id = d.decided_by WHERE d.date_applied >= ? "
			        + "ORDER BY d.date_applied DESC, d.decision_id DESC",
			    new Timestamp(System.currentTimeMillis() - RECENT_DAYS * 24L * 3600 * 1000))) {
				Map<String, Object> entry = describe(row);
				entry.put("conflictId", ((Number) row.get("conflict_id")).longValue());
				entry.put("table", row.get("table_name"));
				entry.put("identifier", row.get("identifier"));
				recent.add(entry);
			}
			result.put("recent", recent);
		});
	}

	/**
	 * @param id the conflict's id in the management schema
	 * @return the conflict with the facility's version and central's lined up field by field, and
	 *         every decision recorded on it
	 * @throws NotFoundException when there is no such conflict
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> get(final long id) {
		final String schema = requireSchema();
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				Map<String, Object> row = conflictRow(connection, schema, id);
				String table = SyncConflictTables.tableOf((String) row.get("model_class_name"));
				String identifier = (String) row.get("identifier");

				Map<String, Object> payload = parse((String) row.get("entity_payload"));
				Object model = payload.get("model");
				Object metadata = payload.get("metadata");
				Map<String, Object> facility = model instanceof Map ? cast(model) : new LinkedHashMap<String, Object>();
				Map<String, Object> meta = metadata instanceof Map ? cast(metadata) : new LinkedHashMap<String, Object>();

				Map<String, Object> central = null;
				if (table != null) {
					central = centralRow(connection, table, identifier);
				}

				Map<String, Object> conflict = new LinkedHashMap<String, Object>();
				conflict.put("id", id);
				conflict.put("table", table);
				conflict.put("identifier", identifier);
				conflict.put("raised", millis(row.get("date_created")));
				// Written by the sending server: dbsync checks the signature, not that the code
				// matches the key that signed it (sync-eip.md 7.2). Who to ask, not proof.
				conflict.put("facility", meta.get("sourceIdentifier"));
				conflict.put("centralMissing", central == null);
				conflict.put("fields", RecordComparison.compare(facility, central, references(connection, table)));

				List<Map<String, Object>> decisions = new ArrayList<Map<String, Object>>();
				for (Map<String, Object> decision : query(connection,
				    "SELECT d.*, u.username FROM liberiaemr_sync_conflict_decision d "
				            + "LEFT JOIN users u ON u.user_id = d.decided_by "
				            + "WHERE d.conflict_id = ? AND d.identifier = ? ORDER BY d.decision_id DESC",
				    id, identifier)) {
					decisions.add(describe(decision));
				}
				conflict.put("decisions", decisions);
				return conflict;
			}
		});
	}

	/**
	 * Records a reviewer's decision. Nothing is applied here: the receiver applies decided
	 * conflicts in its window. A later decision on the same conflict replaces an earlier one that
	 * was not applied yet; both stay in the table.
	 *
	 * @param id the conflict's id
	 * @param identifier the record the reviewer looked at, so a decision cannot land on another
	 * @param decision one of {@link #DECISIONS}
	 * @param reason why, in words that name no patient
	 * @param decidedBy the reviewer
	 * @return the decision as recorded
	 */
	@Transactional
	public Map<String, Object> decide(final long id, final String identifier, final String decision, String reason,
	        final User decidedBy) {
		final String schema = requireSchema();
		if (!DECISIONS.contains(decision)) {
			throw new IllegalArgumentException("decision must be one of " + DECISIONS);
		}
		final String why = reason == null ? "" : reason.trim();
		if (why.isEmpty() || why.length() > REASON_MAX_LENGTH) {
			throw new IllegalArgumentException("a reason of 1 to " + REASON_MAX_LENGTH + " characters is required");
		}
		if (decidedBy == null || decidedBy.getUserId() == null) {
			throw new IllegalArgumentException("a signed-in reviewer is required");
		}

		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				Map<String, Object> row = conflictRow(connection, schema, id);
				if (!row.get("identifier").equals(identifier)) {
					throw new StaleException("conflict " + id + " is not about record " + identifier);
				}
				String table = SyncConflictTables.tableOf((String) row.get("model_class_name"));
				if (table == null) {
					throw new IllegalStateException("conflict " + id + " is in a table dbsync keeps no hashes for");
				}

				String uuid = UUID.randomUUID().toString();
				try (PreparedStatement insert = connection.prepareStatement("INSERT INTO liberiaemr_sync_conflict_decision "
				        + "(conflict_id, identifier, table_name, decision, reason, decided_by, date_decided, uuid) "
				        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
					insert.setLong(1, id);
					insert.setString(2, identifier);
					insert.setString(3, table);
					insert.setString(4, decision);
					insert.setString(5, why);
					insert.setInt(6, decidedBy.getUserId());
					insert.setTimestamp(7, new Timestamp(System.currentTimeMillis()));
					insert.setString(8, uuid);
					insert.executeUpdate();
				}
				return describe(query(connection, "SELECT d.*, u.username FROM liberiaemr_sync_conflict_decision d "
				        + "LEFT JOIN users u ON u.user_id = d.decided_by WHERE d.uuid = ?", uuid).get(0));
			}
		});
	}

	/** Null when unset or not a plain schema name; either way the feature is off. */
	String schema() {
		String value = System.getenv(ENV_MGMT_SCHEMA);
		value = value == null ? "" : value.trim();
		return SCHEMA_NAME.matcher(value).matches() ? value : null;
	}

	private String requireSchema() {
		String schema = schema();
		if (schema == null) {
			throw new NotFoundException("there is no sync receiver on this server");
		}
		return schema;
	}

	private String applyWindow() {
		String value = System.getenv(ENV_APPLY_WINDOW);
		return value == null || value.trim().isEmpty() ? null : value.trim();
	}

	private Map<String, Object> conflictRow(Connection connection, String schema, long id) throws SQLException {
		List<Map<String, Object>> rows = query(connection, "SELECT id, model_class_name, identifier, entity_payload, "
		        + "date_created FROM `" + schema + "`.receiver_conflict_queue WHERE id = ?", id);
		if (rows.isEmpty()) {
			throw new NotFoundException("no conflict " + id + "; it may have been applied already");
		}
		return rows.get(0);
	}

	/**
	 * Central's copy of the record, in the shape dbsync's model has. A table with no uuid of its
	 * own (patient, drug_order) is read through its parent, whose columns keep their names, and
	 * its own columns are added under the table's name as well: dbsync's PatientModel has the
	 * person's creator as creatorUuid and the patient row's as patientCreatorUuid.
	 */
	static Map<String, Object> centralRow(Connection connection, String table, String uuid) throws SQLException {
		String[] parent = SyncConflictTables.parentOf(table);
		String owner = parent == null ? table : parent[0];
		List<Map<String, Object>> found = query(connection, "SELECT * FROM `" + owner + "` WHERE uuid = ?", uuid);
		if (found.isEmpty()) {
			return null;
		}
		Map<String, Object> row = found.get(0);
		if (parent != null) {
			List<Map<String, Object>> own = query(connection,
			    "SELECT * FROM `" + table + "` WHERE `" + parent[2] + "` = ?", row.get(parent[1]));
			if (own.isEmpty()) {
				return null;
			}
			for (Map.Entry<String, Object> column : own.get(0).entrySet()) {
				row.put(table + "_" + column.getKey(), column.getValue());
				if (!row.containsKey(column.getKey())) {
					row.put(column.getKey(), column.getValue());
				}
			}
		}
		return row;
	}
	
	/** The latest decision recorded on each conflict that is not applied yet, by conflict id. */
	private Map<Long, Map<String, Object>> latestDecisions(Connection connection) throws SQLException {
		Map<Long, Map<String, Object>> latest = new HashMap<Long, Map<String, Object>>();
		for (Map<String, Object> row : query(connection, "SELECT d.*, u.username FROM liberiaemr_sync_conflict_decision d "
		        + "LEFT JOIN users u ON u.user_id = d.decided_by WHERE d.date_applied IS NULL ORDER BY d.decision_id")) {
			latest.put(((Number) row.get("conflict_id")).longValue(), row);
		}
		return latest;
	}

	private Map<String, Object> describe(Map<String, Object> row) {
		Map<String, Object> decision = new LinkedHashMap<String, Object>();
		decision.put("decision", row.get("decision"));
		decision.put("reason", row.get("reason"));
		decision.put("decidedBy", row.get("username"));
		decision.put("dateDecided", millis(row.get("date_decided")));
		decision.put("dateApplied", millis(row.get("date_applied")));
		decision.put("applyError", row.get("apply_error"));
		decision.put("dateApplyFailed", millis(row.get("date_apply_failed")));
		return decision;
	}

	/**
	 * Resolves reference columns through the schema's own foreign keys, so each synced table does
	 * not need its own map of what its columns point at.
	 */
	private RecordComparison.References references(final Connection connection, final String table) {
		return new RecordComparison.References() {

			@Override
			public String uuidOf(String column, Object id) {
				try {
					// A column of a joined record may be the parent's (a patient's gender is the person's).
					String[] parent = SyncConflictTables.parentOf(table);
					String parentTable = parent == null ? table : parent[0];
					if (parent != null && column.startsWith(table + "_")) {
						column = column.substring(table.length() + 1);
						parentTable = table;
					}
					List<Map<String, Object>> keys = query(connection,
					    "SELECT referenced_table_name AS ref_table, referenced_column_name AS ref_column "
					            + "FROM information_schema.key_column_usage WHERE table_schema = DATABASE() "
					            + "AND table_name IN (?, ?) AND column_name = ? AND referenced_table_name IS NOT NULL "
					            + "ORDER BY table_name = ? DESC",
					    table, parentTable, column, table);
					if (keys.isEmpty()) {
						return null;
					}
					String refTable = String.valueOf(keys.get(0).get("ref_table"));
					String refColumn = String.valueOf(keys.get(0).get("ref_column"));
					if (!IDENTIFIER.matcher(refTable).matches() || !IDENTIFIER.matcher(refColumn).matches()) {
						return null;
					}
					List<Map<String, Object>> found = query(connection,
					    "SELECT uuid FROM `" + refTable + "` WHERE `" + refColumn + "` = ?", id);
					return found.isEmpty() ? null : (String) found.get(0).get("uuid");
				}
				catch (SQLException e) {
					return null;
				}
			}
		};
	}

	private Map<String, Object> parse(String payload) {
		try {
			return cast(mapper.readValue(payload, LinkedHashMap.class));
		}
		catch (Exception e) {
			// The payload is a patient record: never put it, or the parser's view of it, in a log.
			return new LinkedHashMap<String, Object>();
		}
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> cast(Object map) {
		return (Map<String, Object>) map;
	}

	private static Long millis(Object value) {
		if (value instanceof java.time.LocalDateTime) {
			// What the MySQL driver returns for a DATETIME column; it holds the server's local time.
			return ((java.time.LocalDateTime) value).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
		}
		return value instanceof java.util.Date ? ((java.util.Date) value).getTime() : null;
	}

	static List<Map<String, Object>> query(Connection connection, String sql, Object... params) throws SQLException {
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			for (int i = 0; i < params.length; i++) {
				statement.setObject(i + 1, params[i]);
			}
			List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
			try (ResultSet results = statement.executeQuery()) {
				ResultSetMetaData meta = results.getMetaData();
				while (results.next()) {
					Map<String, Object> row = new LinkedHashMap<String, Object>();
					for (int c = 1; c <= meta.getColumnCount(); c++) {
						row.put(meta.getColumnLabel(c).toLowerCase(), results.getObject(c));
					}
					rows.add(row);
				}
			}
			return rows;
		}
	}
}
