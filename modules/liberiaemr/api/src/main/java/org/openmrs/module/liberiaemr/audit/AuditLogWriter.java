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

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.User;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.Module;
import org.openmrs.module.ModuleFactory;
import org.openmrs.util.OpenmrsConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Writes an event the AuditLog module cannot see on its own into its {@code auditlog_audit_log}
 * table, so it sits in the same trail, the same retention and the same ICT audit viewer as every
 * create, update and delete the module records.
 * <p>
 * The module records Hibernate entity changes only and its API has no write method, so the row is
 * written directly in the module's own shape: {@code action} is CREATED (the module's enum has no
 * read action, and an unknown value would break its own readers), {@code type} names the event, and
 * {@code serialized_data} holds the event's details as a JSON object. The module never stores data
 * on a CREATED row, so the details cannot be confused with an entity's state.
 */
@Component("liberiaemr.AuditLogWriter")
public class AuditLogWriter {

	public static final String ACTION_CREATED = "CREATED";

	private static final ObjectMapper MAPPER = new ObjectMapper();

	@Autowired
	private DbSessionFactory sessionFactory;

	void setSessionFactory(DbSessionFactory sessionFactory) {
		this.sessionFactory = sessionFactory;
	}

	/**
	 * Records one event. Callers that must not act unaudited treat an exception as a refusal.
	 *
	 * @param type the event's name, a class-like name the viewer can filter on
	 * @param identifier what the event concerns, e.g. a patient UUID (cut to 255 characters)
	 * @param user who did it, or null
	 * @param details the event's details, stored as a JSON object
	 * @throws IllegalStateException when the row cannot be written (no AuditLog table, a database
	 *             error)
	 */
	@Transactional
	public void record(final String type, final String identifier, final User user, final Map<String, Object> details,
	        final Date when) {
		final byte[] data;
		try {
			data = MAPPER.writeValueAsString(details).getBytes(StandardCharsets.UTF_8);
		}
		catch (Exception e) {
			throw new IllegalStateException("could not serialise the audit details", e);
		}
		try {
			sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Void>() {

				@Override
				public Void execute(Connection connection) throws SQLException {
					try (PreparedStatement insert = connection.prepareStatement("INSERT INTO " + AuditLogStore.TABLE
					        + " (type, identifier, action, user_id, serialized_data, date_created, openmrs_version, "
					        + "module_version, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
						insert.setString(1, type);
						insert.setString(2, identifier.length() > 255 ? identifier.substring(0, 255) : identifier);
						insert.setString(3, ACTION_CREATED);
						if (user == null || user.getUserId() == null) {
							insert.setNull(4, Types.INTEGER);
						} else {
							insert.setInt(4, user.getUserId());
						}
						insert.setBytes(5, data);
						insert.setTimestamp(6, new Timestamp(when.getTime()));
						insert.setString(7, OpenmrsConstants.OPENMRS_VERSION_SHORT);
						insert.setString(8, auditModuleVersion());
						insert.setString(9, UUID.randomUUID().toString());
						insert.executeUpdate();
					}
					return null;
				}
			});
		}
		catch (RuntimeException e) {
			throw new IllegalStateException("could not write the audit log row for " + type, e);
		}
	}

	/** The AuditLog module's version, as its own rows carry; ours when it is not loaded (tests). */
	protected String auditModuleVersion() {
		Module module = ModuleFactory.getModuleById("auditlog");
		return module == null || module.getVersion() == null ? "unknown" : module.getVersion();
	}
}
