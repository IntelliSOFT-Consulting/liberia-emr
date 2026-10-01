/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.audit;

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.ModuleFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Reads the auditlog module's table, auditlog_audit_log, for the ICT Unit's audit log viewer (MOH
 * ICT SOP control B3). Read-only, and through JDBC with bound parameters rather than the module's
 * AuditLogService: that service has no user filter, no count and no way to page by anything but
 * an offset into a class list, and depending on it would make this module fail to start wherever
 * auditlog is absent. This module is only aware of auditlog (config.xml); without it every read
 * here throws {@link UnavailableException}.
 * <p>
 * Every read needs {@link #PRIVILEGE}, the auditlog module's own privilege, checked here as well
 * as in the controller, so a caller that forgets fails closed. Rows of a credential type are never
 * read and secret-looking values are replaced ({@link AuditLogRedaction}).
 */
@Component("liberiaemr.AuditLogStore")
public class AuditLogStore {

	private static final Logger log = LoggerFactory.getLogger(AuditLogStore.class);

	public static final String PRIVILEGE = "Get Audit Logs";

	public static final String AUDITLOG_MODULE_ID = "auditlog";

	static final String TABLE = "auditlog_audit_log";

	/** The most rows one CSV export writes. The export says so in its headers when it stops there. */
	public static final int MAX_EXPORT_ROWS = 50000;

	/** Rows read per round trip while exporting, so an export never holds the whole result. */
	private int exportBatch = 500;

	/** The most child rows a detail view carries (a patient saved with many names, say). */
	static final int MAX_CHILDREN = 200;

	public static final String DATE_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSZ";

	public static class UnavailableException extends RuntimeException {

		public UnavailableException(String message) {
			super(message);
		}
	}

	private static final String COLUMNS = "a.audit_log_id, a.uuid, a.type, a.identifier, a.action, a.date_created, "
	        + "u.uuid AS user_uuid, u.username, u.system_id, p.uuid AS parent_uuid, "
	        + "CASE WHEN a.serialized_data IS NULL THEN 0 ELSE 1 END AS has_data";

	private static final String FROM = " FROM " + TABLE + " a LEFT JOIN users u ON u.user_id = a.user_id LEFT JOIN "
	        + TABLE + " p ON p.audit_log_id = a.parent_auditlog_id";

	@Autowired
	private DbSessionFactory sessionFactory;

	private final ObjectMapper mapper = new ObjectMapper();

	void setSessionFactory(DbSessionFactory sessionFactory) {
		this.sessionFactory = sessionFactory;
	}

	void setExportBatch(int exportBatch) {
		this.exportBatch = exportBatch;
	}

	/** Whether this server records an audit log that can be read: the module is running and its table exists. */
	@Transactional(readOnly = true)
	public boolean isAvailable() {
		if (!auditModuleStarted()) {
			return false;
		}
		return sessionFactory.getCurrentSession().doReturningWork(AuditLogStore::tableExists);
	}

	/** One page of rows, newest first, with the total that matched. */
	@Transactional(readOnly = true)
	public Map<String, Object> list(final AuditLogQuery query) {
		requireReadable();
		return sessionFactory.getCurrentSession().doReturningWork(connection -> {
			Where where = where(query);
			Map<String, Object> result = new LinkedHashMap<String, Object>();
			result.put("totalCount", count(connection, where));
			result.put("startIndex", query.getStartIndex());
			result.put("limit", query.getLimit());

			List<Object> params = new ArrayList<Object>(where.params);
			params.add(query.getLimit());
			params.add(query.getStartIndex());
			String sql = "SELECT " + COLUMNS + ", " + childCount() + FROM + where.sql
			        + " ORDER BY a.audit_log_id DESC LIMIT ? OFFSET ?";
			List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
			try (PreparedStatement statement = prepare(connection, sql, params); ResultSet rs = statement.executeQuery()) {
				while (rs.next()) {
					Map<String, Object> row = summary(rs);
					row.put("childCount", rs.getInt("child_count"));
					rows.add(row);
				}
			}
			result.put("results", rows);
			return result;
		});
	}

	/**
	 * One row with its recorded values: {@code changes} (previous and current value of each changed
	 * property) for an update, {@code lastState} for a delete, and its parent and children.
	 *
	 * @return null when there is no such row, or it is of a credential type
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> get(final String uuid) {
		requireReadable();
		return sessionFactory.getCurrentSession().doReturningWork(connection -> {
			List<Map<String, Object>> found = detailed(connection, " WHERE a.uuid = ? AND " + notExcluded("a"),
			    Collections.<Object> singletonList(uuid), 1);
			if (found.isEmpty()) {
				return null;
			}
			Map<String, Object> row = found.get(0);
			List<Map<String, Object>> children = detailed(connection,
			    " WHERE a.parent_auditlog_id = ? AND " + notExcluded("a"),
			    Collections.<Object> singletonList(row.remove("_id")), MAX_CHILDREN);
			for (Map<String, Object> child : children) {
				child.remove("_id");
			}
			row.put("children", children);
			return row;
		});
	}

	/** The distinct audited types, for the viewer's type filter. */
	@Transactional(readOnly = true)
	public List<Map<String, Object>> types() {
		requireReadable();
		return sessionFactory.getCurrentSession().doReturningWork(connection -> {
			List<Map<String, Object>> types = new ArrayList<Map<String, Object>>();
			try (PreparedStatement statement = prepare(connection,
			    "SELECT DISTINCT a.type FROM " + TABLE + " a WHERE " + notExcluded("a") + " ORDER BY a.type",
			    Collections.emptyList()); ResultSet rs = statement.executeQuery()) {
				while (rs.next()) {
					String type = rs.getString(1);
					Map<String, Object> entry = new LinkedHashMap<String, Object>();
					entry.put("type", type);
					entry.put("name", displayName(type));
					types.add(entry);
				}
			}
			return types;
		});
	}

	/** How many rows an export with these filters would find, before the cap. */
	@Transactional(readOnly = true)
	public long count(final AuditLogQuery query) {
		requireReadable();
		return sessionFactory.getCurrentSession().doReturningWork(connection -> count(connection, where(query)));
	}

	/**
	 * Writes the matching rows as CSV, newest first, at most {@code maxRows}, flushing after each
	 * batch so the response streams. The paging in {@code query} is ignored: an export starts at the
	 * newest row.
	 *
	 * @return the number of rows written
	 */
	@Transactional(readOnly = true)
	public int export(final AuditLogQuery query, final int maxRows, final Writer out) throws IOException {
		requireReadable();
		final int cap = Math.min(Math.max(1, maxRows), MAX_EXPORT_ROWS);
		out.write(AuditLogCsv.header());
		final int[] written = { 0 };
		final Where where = where(query);
		final Integer[] last = { null };
		while (written[0] < cap) {
			final int batch = Math.min(exportBatch, cap - written[0]);
			List<Map<String, Object>> rows = sessionFactory.getCurrentSession().doReturningWork(connection -> {
				List<Object> params = new ArrayList<Object>(where.params);
				String sql = where.sql;
				if (last[0] != null) {
					sql += " AND a.audit_log_id < ?";
					params.add(last[0]);
				}
				return detailed(connection, sql, params, batch);
			});
			for (Map<String, Object> row : rows) {
				last[0] = (Integer) row.remove("_id");
				out.write(AuditLogCsv.row(row));
				written[0]++;
			}
			out.flush();
			if (rows.size() < batch) {
				break;
			}
		}
		return written[0];
	}

	// ---------------------------------------------------------------------------------------------

	/** Overridden in tests, which run without the auditlog module. */
	protected boolean auditModuleStarted() {
		return ModuleFactory.isModuleStarted(AUDITLOG_MODULE_ID);
	}

	/** Overridden in tests, which run without an OpenMRS user context. */
	protected boolean permitted() {
		return Context.isAuthenticated() && Context.hasPrivilege(PRIVILEGE);
	}

	private void requireReadable() {
		if (!permitted()) {
			throw new APIAuthenticationException(PRIVILEGE + " is required to read the audit log");
		}
		if (!isAvailable()) {
			throw new UnavailableException(
			        "The audit log is not recorded on this server: the auditlog module is not installed or not started");
		}
	}

	private static Boolean tableExists(Connection connection) throws SQLException {
		DatabaseMetaData meta = connection.getMetaData();
		for (String name : new String[] { TABLE, TABLE.toUpperCase() }) {
			try (ResultSet rs = meta.getTables(connection.getCatalog(), null, name, new String[] { "TABLE" })) {
				if (rs.next()) {
					return true;
				}
			}
		}
		return false;
	}

	static final class Where {

		final String sql;

		final List<Object> params;

		Where(String sql, List<Object> params) {
			this.sql = sql;
			this.params = params;
		}
	}

	static Where where(AuditLogQuery query) {
		StringBuilder sql = new StringBuilder(" WHERE ").append(notExcluded("a"));
		List<Object> params = new ArrayList<Object>();
		if (query.getFrom() != null) {
			sql.append(" AND a.date_created >= ?");
			params.add(Timestamp.valueOf(query.getFrom()));
		}
		if (query.getToExclusive() != null) {
			sql.append(" AND a.date_created < ?");
			params.add(Timestamp.valueOf(query.getToExclusive()));
		}
		if (query.getUser() != null) {
			sql.append(" AND (u.username = ? OR u.system_id = ? OR u.uuid = ?)");
			params.add(query.getUser());
			params.add(query.getUser());
			params.add(query.getUser());
		}
		if (query.getType() != null) {
			if (query.isSimpleType()) {
				sql.append(" AND (a.type = ? OR a.type LIKE ? ESCAPE '!' OR a.type LIKE ? ESCAPE '!')");
				params.add(query.getType());
				params.add("%." + like(query.getType()));
				params.add("%$" + like(query.getType()));
			} else {
				sql.append(" AND a.type = ?");
				params.add(query.getType());
			}
		}
		if (!query.getActions().isEmpty()) {
			sql.append(" AND a.action IN (").append(StringUtils.repeat("?", ", ", query.getActions().size())).append(")");
			params.addAll(query.getActions());
		}
		if (query.isTopLevelOnly()) {
			sql.append(" AND a.parent_auditlog_id IS NULL");
		}
		return new Where(sql.toString(), params);
	}

	/**
	 * Excludes the credential types and any subclass (a Hibernate proxy) of them. The types are
	 * constants of this module, written in as literals so that the clause can sit anywhere in a
	 * statement, subqueries included, without shifting the bound parameters.
	 */
	static String notExcluded(String alias) {
		StringBuilder sql = new StringBuilder("(");
		for (String type : AuditLogRedaction.EXCLUDED_TYPES) {
			if (!type.matches("[A-Za-z0-9_.$]+")) {
				throw new IllegalStateException("not a class name: " + type);
			}
			if (sql.length() > 1) {
				sql.append(" AND ");
			}
			sql.append(alias).append(".type <> '").append(type).append("' AND ").append(alias)
			        .append(".type NOT LIKE '").append(like(type)).append("$%' ESCAPE '!'");
		}
		return sql.append(")").toString();
	}

	private static String childCount() {
		return "(SELECT COUNT(*) FROM " + TABLE + " c WHERE c.parent_auditlog_id = a.audit_log_id AND "
		        + notExcluded("c") + ") AS child_count";
	}

	/** Escapes LIKE's wildcards with '!', the escape character every query here declares. */
	private static String like(String value) {
		return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
	}

	private static long count(Connection connection, Where where) throws SQLException {
		try (PreparedStatement statement = prepare(connection, "SELECT COUNT(*)" + FROM + where.sql, where.params);
		        ResultSet rs = statement.executeQuery()) {
			return rs.next() ? rs.getLong(1) : 0;
		}
	}

	/** Rows with their recorded values, newest first. Each carries its row id as "_id" for the caller to remove. */
	private List<Map<String, Object>> detailed(Connection connection, String whereSql, List<Object> params, int limit)
	        throws SQLException {
		List<Object> all = new ArrayList<Object>(params);
		all.add(limit);
		String sql = "SELECT " + COLUMNS + ", a.serialized_data" + FROM + whereSql
		        + " ORDER BY a.audit_log_id DESC LIMIT ?";
		List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
		try (PreparedStatement statement = prepare(connection, sql, all); ResultSet rs = statement.executeQuery()) {
			while (rs.next()) {
				Map<String, Object> row = summary(rs);
				row.put("_id", rs.getInt("audit_log_id"));
				addValues(row, rs.getBytes("serialized_data"));
				rows.add(row);
			}
		}
		return rows;
	}

	private static PreparedStatement prepare(Connection connection, String sql, List<Object> params) throws SQLException {
		PreparedStatement statement = connection.prepareStatement(sql);
		for (int i = 0; i < params.size(); i++) {
			statement.setObject(i + 1, params.get(i));
		}
		return statement;
	}

	private static Map<String, Object> summary(ResultSet rs) throws SQLException {
		Map<String, Object> row = new LinkedHashMap<String, Object>();
		String type = rs.getString("type");
		row.put("uuid", rs.getString("uuid"));
		row.put("dateCreated", format(rs.getTimestamp("date_created")));
		row.put("action", rs.getString("action"));
		row.put("type", type);
		row.put("typeName", displayName(type));
		row.put("identifier", rs.getString("identifier"));
		String userUuid = rs.getString("user_uuid");
		if (userUuid == null) {
			row.put("user", null);
		} else {
			Map<String, Object> user = new LinkedHashMap<String, Object>();
			user.put("uuid", userUuid);
			user.put("username", rs.getString("username"));
			user.put("systemId", rs.getString("system_id"));
			row.put("user", user);
		}
		row.put("parentUuid", rs.getString("parent_uuid"));
		row.put("hasValues", rs.getInt("has_data") == 1);
		return row;
	}

	/**
	 * Adds the recorded values: {@code changes} for an update (the module stores
	 * {"property": [current, previous]}), {@code lastState} for a delete ({"property": value}).
	 * A created row has none. Values of secret-looking properties are replaced.
	 */
	private void addValues(Map<String, Object> row, byte[] data) {
		String action = (String) row.get("action");
		String type = (String) row.get("type");
		String identifier = (String) row.get("identifier");
		Map<String, Object> values = parse(data, (String) row.get("uuid"));
		if ("UPDATED".equals(action)) {
			List<Map<String, Object>> changes = new ArrayList<Map<String, Object>>();
			for (Map.Entry<String, Object> entry : values.entrySet()) {
				Object current = null;
				Object previous = null;
				if (entry.getValue() instanceof List) {
					List<?> pair = (List<?>) entry.getValue();
					current = pair.size() > 0 ? pair.get(0) : null;
					previous = pair.size() > 1 ? pair.get(1) : null;
				}
				Map<String, Object> change = new LinkedHashMap<String, Object>();
				change.put("property", entry.getKey());
				change.put("previous", AuditLogRedaction.value(type, identifier, entry.getKey(), previous));
				change.put("current", AuditLogRedaction.value(type, identifier, entry.getKey(), current));
				change.put("redacted", AuditLogRedaction.isRedacted(type, identifier, entry.getKey()));
				changes.add(change);
			}
			row.put("changes", changes);
		} else if ("DELETED".equals(action)) {
			List<Map<String, Object>> state = new ArrayList<Map<String, Object>>();
			for (Map.Entry<String, Object> entry : values.entrySet()) {
				Map<String, Object> property = new LinkedHashMap<String, Object>();
				property.put("property", entry.getKey());
				property.put("value", AuditLogRedaction.value(type, identifier, entry.getKey(), entry.getValue()));
				property.put("redacted", AuditLogRedaction.isRedacted(type, identifier, entry.getKey()));
				state.add(property);
			}
			row.put("lastState", state);
		}
	}

	private Map<String, Object> parse(byte[] data, String uuid) {
		if (data == null || data.length == 0) {
			return Collections.emptyMap();
		}
		try {
			Map<String, Object> values = mapper.readValue(new String(data, StandardCharsets.UTF_8),
			    new TypeReference<LinkedHashMap<String, Object>>() {});
			return values == null ? Collections.<String, Object> emptyMap() : new java.util.TreeMap<String, Object>(values);
		}
		catch (IOException e) {
			// The row's values are not JSON; say so without echoing them, which may be PHI.
			log.warn("Audit log row {} holds values that are not a JSON object", uuid);
			return Collections.emptyMap();
		}
	}

	private static String format(Timestamp timestamp) {
		return timestamp == null ? null : new SimpleDateFormat(DATE_FORMAT).format(timestamp);
	}

	/**
	 * A readable name for a class name: org.openmrs.GlobalProperty is "Global Property". A Hibernate
	 * proxy's suffix and an outer class are dropped.
	 */
	static String displayName(String type) {
		if (type == null) {
			return null;
		}
		String name = type;
		int proxy = name.indexOf("$HibernateProxy");
		if (proxy > 0) {
			name = name.substring(0, proxy);
		}
		name = name.substring(Math.max(name.lastIndexOf('.'), name.lastIndexOf('$')) + 1);
		return StringUtils.join(StringUtils.splitByCharacterTypeCamelCase(name), " ");
	}
}
