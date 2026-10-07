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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/**
 * Events written into the AuditLog module's table: the row has the module's shape, and the ICT
 * audit viewer shows its details.
 */
public class AuditLogWriterTest extends BaseModuleContextSensitiveTest {

	private static final String TYPE = "org.openmrs.module.liberiaemr.RemoteHistoryAccess";

	private static final String PATIENT = "11111111-1111-1111-1111-111111111111";

	private DbSessionFactory sessions;

	private AuditLogWriter writer;

	@Before
	public void setUp() {
		sessions = Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class);
		writer = new AuditLogWriter();
		writer.setSessionFactory(sessions);
		sql("CREATE TABLE IF NOT EXISTS auditlog_audit_log (audit_log_id INT AUTO_INCREMENT PRIMARY KEY, "
		        + "type VARCHAR(512) NOT NULL, identifier VARCHAR(255) NOT NULL, action VARCHAR(50) NOT NULL, "
		        + "user_id INT, serialized_data BLOB, date_created TIMESTAMP NOT NULL, "
		        + "openmrs_version VARCHAR(50) NOT NULL, module_version VARCHAR(50) NOT NULL, "
		        + "parent_auditlog_id INT, uuid VARCHAR(38) NOT NULL UNIQUE)");
		sql("DELETE FROM auditlog_audit_log");
	}

	private void sql(final String statement) {
		sessions.getCurrentSession().doWork(connection -> {
			try (Statement s = connection.createStatement()) {
				s.execute(statement);
			}
		});
	}

	private static Map<String, Object> details() {
		Map<String, Object> details = new LinkedHashMap<String, Object>();
		details.put("outcome", "SERVED");
		details.put("requestingFacility", "22222222-2222-2222-2222-222222222222");
		details.put("resourceCount", 3);
		return details;
	}

	@Test
	public void writesARowInTheModulesOwnShape() {
		writer.record(TYPE, PATIENT, Context.getAuthenticatedUser(), details(), new Date());

		final List<String> rows = new ArrayList<String>();
		sessions.getCurrentSession().doWork(connection -> {
			try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(
			    "SELECT type, identifier, action, user_id, serialized_data, openmrs_version, uuid FROM auditlog_audit_log")) {
				while (rs.next()) {
					rows.add(rs.getString(1) + "|" + rs.getString(2) + "|" + rs.getString(3) + "|" + rs.getInt(4) + "|"
					        + new String(rs.getBytes(5), StandardCharsets.UTF_8) + "|" + !rs.getString(6).isEmpty() + "|"
					        + (rs.getString(7).length() == 36));
				}
			}
		});

		assertEquals(1, rows.size());
		assertEquals(TYPE + "|" + PATIENT + "|CREATED|1|{\"outcome\":\"SERVED\",\"requestingFacility\":"
		        + "\"22222222-2222-2222-2222-222222222222\",\"resourceCount\":3}|true|true", rows.get(0));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theAuditViewerShowsTheDetails() {
		writer.record(TYPE, PATIENT, Context.getAuthenticatedUser(), details(), new Date());
		final String[] uuid = new String[1];
		sessions.getCurrentSession().doWork(connection -> {
			try (Statement s = connection.createStatement();
			        ResultSet rs = s.executeQuery("SELECT uuid FROM auditlog_audit_log")) {
				rs.next();
				uuid[0] = rs.getString(1);
			}
		});
		AuditLogStoreTest.TestStore store = new AuditLogStoreTest.TestStore();
		store.setSessionFactory(sessions);

		Map<String, Object> row = store.get(uuid[0]);

		assertEquals(TYPE, row.get("type"));
		assertEquals("CREATED", row.get("action"));
		List<Map<String, Object>> shown = (List<Map<String, Object>>) row.get("details");
		List<String> properties = new ArrayList<String>();
		for (Map<String, Object> property : shown) {
			properties.add(property.get("property") + "=" + property.get("value"));
		}
		assertTrue(properties.toString(), properties.contains("outcome=SERVED"));
		assertTrue(properties.toString(), properties.contains("resourceCount=3"));
	}

	@Test
	public void aMissingAuditTableIsAnErrorTheCallerCanRefuseOn() {
		sql("DROP TABLE auditlog_audit_log");
		try {
			writer.record(TYPE, PATIENT, null, details(), new Date());
			fail("expected the write to fail");
		}
		catch (IllegalStateException expected) {
			assertTrue(expected.getMessage().contains(TYPE));
		}
	}
}
