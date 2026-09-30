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

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import liquibase.Contexts;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.FileSystemResourceAccessor;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/**
 * The audit log viewer's reads, against a real auditlog_audit_log table (the auditlog module's own
 * DDL, in H2) holding rows shaped as the module writes them.
 */
public class AuditLogStoreTest extends BaseModuleContextSensitiveTest {

	private static final String ADMIN_UUID = "1010d442-e134-11de-babe-001e378eb67e";

	private static final int ADMIN = 1;

	private static final int BUTCH = 502;

	private DbSessionFactory sessions;

	private TestStore store;

	private int nextId = 1000;

	/** The store without the auditlog module or a user context: both are switches here. */
	static class TestStore extends AuditLogStore {

		boolean moduleStarted = true;

		boolean permitted = true;

		@Override
		protected boolean auditModuleStarted() {
			return moduleStarted;
		}

		@Override
		protected boolean permitted() {
			return permitted;
		}
	}

	@Before
	public void setUp() {
		sessions = Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class);
		store = new TestStore();
		store.setSessionFactory(sessions);
		sql("CREATE TABLE IF NOT EXISTS auditlog_audit_log (audit_log_id INT AUTO_INCREMENT PRIMARY KEY, "
		        + "type VARCHAR(512) NOT NULL, identifier VARCHAR(255) NOT NULL, action VARCHAR(50) NOT NULL, "
		        + "user_id INT, serialized_data BLOB, date_created TIMESTAMP NOT NULL, "
		        + "openmrs_version VARCHAR(50) NOT NULL, module_version VARCHAR(50) NOT NULL, "
		        + "parent_auditlog_id INT, uuid VARCHAR(38) NOT NULL UNIQUE)");
		sql("DELETE FROM auditlog_audit_log");
	}

	// --- fixtures ---------------------------------------------------------------------------------

	private void sql(final String statement) {
		sessions.getCurrentSession().doWork(connection -> {
			try (Statement s = connection.createStatement()) {
				s.execute(statement);
			}
		});
	}

	private int row(String uuid, String type, String identifier, String action, Integer userId, String date,
	        String data, Integer parent) {
		final int id = nextId++;
		sessions.getCurrentSession().doWork(connection -> {
			try (PreparedStatement s = connection.prepareStatement("INSERT INTO auditlog_audit_log (audit_log_id, type, "
			        + "identifier, action, user_id, serialized_data, date_created, openmrs_version, module_version, "
			        + "parent_auditlog_id, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, '2.8.8', '1.2.0', ?, ?)")) {
				s.setInt(1, id);
				s.setString(2, type);
				s.setString(3, identifier);
				s.setString(4, action);
				s.setObject(5, userId);
				s.setBytes(6, data == null ? null : data.getBytes(StandardCharsets.UTF_8));
				s.setTimestamp(7, Timestamp.valueOf(date));
				s.setObject(8, parent);
				s.setString(9, uuid);
				s.executeUpdate();
			}
		});
		return id;
	}

	/** Five ordinary rows over three days, two users, three types and all three actions. */
	private void standardRows() {
		row("a1", "org.openmrs.Location", "7", "CREATED", ADMIN, "2026-09-01 08:00:00", null, null);
		row("a2", "org.openmrs.Location", "7", "UPDATED", BUTCH, "2026-09-02 09:00:00",
		    "{\"name\":[\"Careysburg HC\",\"Careysburg\"],\"description\":[null,\"old\"]}", null);
		row("a3", "org.openmrs.GlobalProperty", "locale.allowed.list", "UPDATED", ADMIN, "2026-09-02 10:00:00",
		    "{\"propertyValue\":[\"en, fr\",\"en\"]}", null);
		row("a4", "org.openmrs.Location", "8", "DELETED", ADMIN, "2026-09-03 11:00:00",
		    "{\"name\":\"Old Ward\",\"uuid\":\"loc-8\"}", null);
		row("a5", "org.openmrs.module.appointments.model.AppointmentServiceDefinition", "3", "CREATED", null,
		    "2026-09-03 12:00:00", null, null);
	}

	private static AuditLogQuery query(String from, String to, String user, String type, String action) {
		return AuditLogQuery.parse(from, to, user, type, action, null, 0, 50);
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> results(Map<String, Object> page) {
		return (List<Map<String, Object>>) page.get("results");
	}

	private static List<String> uuids(Map<String, Object> page) {
		List<String> uuids = new ArrayList<String>();
		for (Map<String, Object> row : results(page)) {
			uuids.add((String) row.get("uuid"));
		}
		return uuids;
	}

	private static List<String> list(String... values) {
		List<String> list = new ArrayList<String>();
		for (String value : values) {
			list.add(value);
		}
		return list;
	}

	// --- availability and authorisation -----------------------------------------------------------

	@Test
	public void isUnavailableWithoutTheAuditlogModule() {
		store.moduleStarted = false;
		assertFalse(store.isAvailable());
		try {
			store.list(query(null, null, null, null, null));
			fail("expected UnavailableException");
		}
		catch (AuditLogStore.UnavailableException expected) {
			assertThat(expected.getMessage(), containsString("auditlog module"));
		}
	}

	@Test
	public void isAvailableWithTheModuleAndItsTable() {
		assertTrue(store.isAvailable());
	}

	@Test
	public void refusesEveryReadWithoutThePrivilege() throws IOException {
		standardRows();
		store.permitted = false;
		try {
			store.list(query(null, null, null, null, null));
			fail("list");
		}
		catch (APIAuthenticationException expected) {}
		try {
			store.get("a1");
			fail("get");
		}
		catch (APIAuthenticationException expected) {}
		try {
			store.types();
			fail("types");
		}
		catch (APIAuthenticationException expected) {}
		try {
			store.export(query(null, null, null, null, null), 10, new StringWriter());
			fail("export");
		}
		catch (APIAuthenticationException expected) {}
	}

	@Test
	public void theRealStoreChecksTheUsersPrivilege() {
		AuditLogStore real = new AuditLogStore() {

			@Override
			protected boolean auditModuleStarted() {
				return true;
			}
		};
		// The test user is a superuser, who holds every privilege; logged out, nobody does.
		Context.logout();
		try {
			real.list(query(null, null, null, null, null));
			fail("expected APIAuthenticationException");
		}
		catch (APIAuthenticationException expected) {}
	}

	// --- paging -----------------------------------------------------------------------------------

	@Test
	public void pagesNewestFirstWithTheTotal() {
		standardRows();
		Map<String, Object> first = store.list(AuditLogQuery.parse(null, null, null, null, null, null, 0, 2));
		assertEquals(5L, first.get("totalCount"));
		assertEquals(list("a5", "a4"), uuids(first));
		Map<String, Object> second = store.list(AuditLogQuery.parse(null, null, null, null, null, null, 2, 2));
		assertEquals(list("a3", "a2"), uuids(second));
		Map<String, Object> last = store.list(AuditLogQuery.parse(null, null, null, null, null, null, 4, 2));
		assertEquals(list("a1"), uuids(last));
		assertEquals(4, last.get("startIndex"));
		assertEquals(2, last.get("limit"));
	}

	@Test
	public void summarisesARow() {
		standardRows();
		Map<String, Object> row = results(store.list(query(null, null, "admin", "GlobalProperty", null))).get(0);
		assertEquals("a3", row.get("uuid"));
		assertEquals("UPDATED", row.get("action"));
		assertEquals("org.openmrs.GlobalProperty", row.get("type"));
		assertEquals("Global Property", row.get("typeName"));
		assertEquals("locale.allowed.list", row.get("identifier"));
		assertEquals(true, row.get("hasValues"));
		assertEquals(0, row.get("childCount"));
		@SuppressWarnings("unchecked")
		Map<String, Object> user = (Map<String, Object>) row.get("user");
		assertEquals("admin", user.get("username"));
		assertEquals(ADMIN_UUID, user.get("uuid"));
		assertThat((String) row.get("dateCreated"), containsString("2026-09-02T10:00:00.000"));
	}

	// --- filters ----------------------------------------------------------------------------------

	@Test
	public void filtersByDateRangeWithWholeDays() {
		standardRows();
		assertEquals(list("a3", "a2"), uuids(store.list(query("2026-09-02", "2026-09-02", null, null, null))));
		assertEquals(list("a5", "a4", "a3"), uuids(store.list(query("2026-09-02T10:00:00", null, null, null, null))));
		assertEquals(list("a1"), uuids(store.list(query(null, "2026-09-01", null, null, null))));
	}

	@Test
	public void filtersByUsernameSystemIdOrUuid() {
		standardRows();
		assertEquals(list("a2"), uuids(store.list(query(null, null, "butch", null, null))));
		assertEquals(list("a2"), uuids(store.list(query(null, null, "3-4", null, null))));
		assertEquals(list("a4", "a3", "a1"), uuids(store.list(query(null, null, ADMIN_UUID, null, null))));
		assertEquals(list(), uuids(store.list(query(null, null, "nobody", null, null))));
	}

	@Test
	public void filtersByClassNameOrSimpleName() {
		standardRows();
		assertEquals(list("a4", "a2", "a1"), uuids(store.list(query(null, null, null, "org.openmrs.Location", null))));
		assertEquals(list("a4", "a2", "a1"), uuids(store.list(query(null, null, null, "Location", null))));
		assertEquals(list("a5"), uuids(store.list(query(null, null, null, "AppointmentServiceDefinition", null))));
		// A simple name matches the whole last segment, not a suffix of it.
		assertEquals(list(), uuids(store.list(query(null, null, null, "ServiceDefinition", null))));
		// LIKE's wildcards in a filter are literal.
		assertEquals(list(), uuids(store.list(query(null, null, null, "Loc_tion", null))));
	}

	@Test
	public void filtersByOneOrMoreActions() {
		standardRows();
		assertEquals(list("a4"), uuids(store.list(query(null, null, null, null, "DELETED"))));
		assertEquals(list("a5", "a4", "a1"), uuids(store.list(query(null, null, null, null, "created,deleted"))));
	}

	@Test
	public void combinesFilters() {
		standardRows();
		assertEquals(list("a3"), uuids(store.list(query("2026-09-02", "2026-09-03", "admin", null, "UPDATED"))));
	}

	@Test
	public void topLevelOnlyLeavesOutChildRows() {
		int parent = row("p1", "org.openmrs.Person", "5", "UPDATED", ADMIN, "2026-09-04 08:00:00", "{}", null);
		row("c1", "org.openmrs.PersonName", "9", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"givenName\":[\"Jane\",\"Janet\"]}", parent);
		assertEquals(list("c1", "p1"), uuids(store.list(query(null, null, null, null, null))));
		assertEquals(list("p1"),
		    uuids(store.list(AuditLogQuery.parse(null, null, null, null, null, true, 0, 50))));
		Map<String, Object> p1 = results(store.list(AuditLogQuery.parse(null, null, null, null, null, true, 0, 50)))
		        .get(0);
		assertEquals(1, p1.get("childCount"));
	}

	// --- detail -----------------------------------------------------------------------------------

	@Test
	@SuppressWarnings("unchecked")
	public void detailOfAnUpdateHasPreviousAndCurrentValues() {
		standardRows();
		Map<String, Object> row = store.get("a2");
		List<Map<String, Object>> changes = (List<Map<String, Object>>) row.get("changes");
		assertEquals(2, changes.size());
		Map<String, Object> description = changes.get(0);
		assertEquals("description", description.get("property"));
		assertEquals("old", description.get("previous"));
		assertNull(description.get("current"));
		Map<String, Object> name = changes.get(1);
		assertEquals("name", name.get("property"));
		assertEquals("Careysburg", name.get("previous"));
		assertEquals("Careysburg HC", name.get("current"));
		assertEquals(false, name.get("redacted"));
		assertFalse(row.containsKey("_id"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void detailOfADeleteHasTheLastState() {
		standardRows();
		List<Map<String, Object>> state = (List<Map<String, Object>>) store.get("a4").get("lastState");
		assertEquals("name", state.get(0).get("property"));
		assertEquals("Old Ward", state.get(0).get("value"));
		assertEquals("uuid", state.get(1).get("property"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void detailCarriesChildRowsWithTheirChanges() {
		int parent = row("p1", "org.openmrs.Person", "5", "UPDATED", ADMIN, "2026-09-04 08:00:00", "{}", null);
		row("c1", "org.openmrs.PersonName", "9", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"givenName\":[\"Jane\",\"Janet\"]}", parent);
		Map<String, Object> row = store.get("p1");
		List<Map<String, Object>> children = (List<Map<String, Object>>) row.get("children");
		assertEquals(1, children.size());
		assertEquals("c1", children.get(0).get("uuid"));
		assertEquals("p1", children.get(0).get("parentUuid"));
		List<Map<String, Object>> changes = (List<Map<String, Object>>) children.get(0).get("changes");
		assertEquals("Janet", changes.get(0).get("previous"));
		assertEquals("Jane", changes.get(0).get("current"));
		assertFalse(children.get(0).containsKey("_id"));
	}

	@Test
	public void detailOfAnUnknownRowIsNull() {
		assertNull(store.get("nope"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void detailSurvivesValuesThatAreNotJson() {
		row("bad", "org.openmrs.Location", "1", "UPDATED", ADMIN, "2026-09-04 08:00:00", "not json", null);
		assertTrue(((List<Object>) store.get("bad").get("changes")).isEmpty());
	}

	// --- credential material ----------------------------------------------------------------------

	@Test
	public void neverReturnsCredentialRows() {
		standardRows();
		row("cred", "org.openmrs.api.db.LoginCredential", "1", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"hashedPassword\":[\"new\",\"old\"],\"salt\":[\"s2\",\"s1\"]}", null);
		row("proxy", "org.openmrs.api.db.LoginCredential$HibernateProxy$x1", "1", "UPDATED", ADMIN,
		    "2026-09-04 08:00:00", "{}", null);
		row("reset", "org.openmrs.module.liberiaemr.PasswordResetToken", "4", "CREATED", ADMIN, "2026-09-04 08:00:00",
		    null, null);
		Map<String, Object> page = store.list(query(null, null, null, null, null));
		assertEquals(5L, page.get("totalCount"));
		assertFalse(uuids(page).contains("cred"));
		assertEquals(list(), uuids(store.list(query(null, null, null, "LoginCredential", null))));
		assertEquals(list(), uuids(store.list(query(null, null, null, "org.openmrs.api.db.LoginCredential", null))));
		assertNull(store.get("cred"));
		assertNull(store.get("proxy"));
		assertNull(store.get("reset"));
		for (Map<String, Object> type : store.types()) {
			assertFalse(AuditLogRedaction.isExcludedType((String) type.get("type")));
		}
	}

	@Test
	public void childCountLeavesOutCredentialRows() {
		int parent = row("u1", "org.openmrs.User", "5", "UPDATED", ADMIN, "2026-09-04 08:00:00", "{}", null);
		row("uc", "org.openmrs.api.db.LoginCredential", "5", "UPDATED", ADMIN, "2026-09-04 08:00:00", "{}", parent);
		Map<String, Object> u1 = results(store.list(query(null, null, null, "User", null))).get(0);
		assertEquals(0, u1.get("childCount"));
		@SuppressWarnings("unchecked")
		List<Object> children = (List<Object>) store.get("u1").get("children");
		assertTrue(children.isEmpty());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void redactsSecretGlobalPropertiesAndProperties() {
		row("gp", "org.openmrs.GlobalProperty", "liberiaemr.email.password", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"propertyValue\":[\"hunter2\",\"letmein\"]}", null);
		row("gpd", "org.openmrs.GlobalProperty", "liberiaemr.sms.provider.apiKey", "DELETED", ADMIN,
		    "2026-09-04 08:00:00", "{\"property\":\"liberiaemr.sms.provider.apiKey\",\"propertyValue\":\"k-123\"}",
		    null);
		row("policy", "org.openmrs.GlobalProperty", "security.passwordMinimumLength", "UPDATED", ADMIN,
		    "2026-09-04 08:00:00", "{\"propertyValue\":[\"12\",\"8\"]}", null);
		row("usr", "org.openmrs.User", "5", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    // As the module stores a login: userProperties as JSON objects, previous and current.
		    "{\"secretAnswer\":[\"a\",\"b\"],\"userProperties\":[{\"lastLoginTimestamp\":\"2\","
		            + "\"resetToken\":\"t2\"},{\"lastLoginTimestamp\":\"1\"}]}",
		    null);

		Map<String, Object> gp = ((List<Map<String, Object>>) store.get("gp").get("changes")).get(0);
		assertEquals(AuditLogRedaction.REDACTED, gp.get("previous"));
		assertEquals(AuditLogRedaction.REDACTED, gp.get("current"));
		assertEquals(true, gp.get("redacted"));

		List<Map<String, Object>> gpd = (List<Map<String, Object>>) store.get("gpd").get("lastState");
		assertEquals("liberiaemr.sms.provider.apiKey", gpd.get(0).get("value"));
		assertEquals(AuditLogRedaction.REDACTED, gpd.get(1).get("value"));

		Map<String, Object> policy = ((List<Map<String, Object>>) store.get("policy").get("changes")).get(0);
		assertEquals("8", policy.get("previous"));
		assertEquals("12", policy.get("current"));

		List<Map<String, Object>> usr = (List<Map<String, Object>>) store.get("usr").get("changes");
		assertEquals("secretAnswer", usr.get(0).get("property"));
		assertEquals(AuditLogRedaction.REDACTED, usr.get(0).get("current"));
		Map<String, Object> properties = (Map<String, Object>) usr.get(1).get("current");
		assertEquals("2", properties.get("lastLoginTimestamp"));
		assertEquals(AuditLogRedaction.REDACTED, properties.get("resetToken"));
		assertEquals("1", ((Map<String, Object>) usr.get(1).get("previous")).get("lastLoginTimestamp"));
	}

	// --- types ------------------------------------------------------------------------------------

	@Test
	public void listsTheAuditedTypesWithReadableNames() {
		standardRows();
		List<Map<String, Object>> types = store.types();
		assertEquals(3, types.size());
		assertEquals("org.openmrs.GlobalProperty", types.get(0).get("type"));
		assertEquals("Global Property", types.get(0).get("name"));
		assertEquals("Appointment Service Definition", types.get(2).get("name"));
	}

	// --- CSV --------------------------------------------------------------------------------------

	@Test
	public void exportsMatchingRowsAsCsvAcrossBatches() throws IOException {
		standardRows();
		store.setExportBatch(2);
		StringWriter out = new StringWriter();
		int written = store.export(query(null, null, null, null, null), 100, out);
		assertEquals(5, written);
		String[] lines = out.toString().split("\r\n");
		assertEquals(6, lines.length);
		assertEquals("date,action,type,identifier,username,user_uuid,uuid,parent_uuid,values", lines[0]);
		assertThat(lines[1], containsString("a5"));
		assertThat(lines[5], containsString("a1"));
		assertThat(out.toString(), containsString("description: old ->  | name: Careysburg -> Careysburg HC"));
		assertThat(out.toString(), containsString("\"propertyValue: en -> en, fr\""));
		assertThat(out.toString(), containsString("name = Old Ward | uuid = loc-8"));
	}

	@Test
	public void exportStopsAtTheCapAndUsesTheFilters() throws IOException {
		standardRows();
		store.setExportBatch(2);
		StringWriter out = new StringWriter();
		assertEquals(3, store.export(query(null, null, null, null, null), 3, out));
		assertEquals(4, out.toString().split("\r\n").length);
		assertEquals(5L, store.count(query(null, null, null, null, null)));

		StringWriter filtered = new StringWriter();
		assertEquals(1, store.export(query(null, null, "butch", null, null), 100, filtered));
		assertThat(filtered.toString(), containsString("a2"));
	}

	@Test
	public void exportLeavesOutCredentialRowsAndRedacts() throws IOException {
		row("cred", "org.openmrs.api.db.LoginCredential", "1", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"salt\":[\"s2\",\"s1\"]}", null);
		row("gp", "org.openmrs.GlobalProperty", "liberiaemr.email.password", "UPDATED", ADMIN, "2026-09-04 08:00:00",
		    "{\"propertyValue\":[\"hunter2\",\"letmein\"]}", null);
		StringWriter out = new StringWriter();
		assertEquals(1, store.export(query(null, null, null, null, null), 100, out));
		assertThat(out.toString(), not(containsString("s1")));
		assertThat(out.toString(), not(containsString("hunter2")));
		assertThat(out.toString(), containsString("[redacted]"));
	}

	// --- schema -----------------------------------------------------------------------------------

	@Test
	public void liquibaseIndexesTheAuditTable() {
		sessions.getCurrentSession().doWork(connection -> {
			applyLiquibase(connection);
			List<String> indexes = new ArrayList<String>();
			try (ResultSet rs = connection.getMetaData().getIndexInfo(connection.getCatalog(), null,
			    "AUDITLOG_AUDIT_LOG", false, false)) {
				while (rs.next()) {
					indexes.add(String.valueOf(rs.getString("INDEX_NAME")).toLowerCase());
				}
			}
			assertTrue(indexes.toString(), indexes.contains("liberiaemr_auditlog_date_idx"));
			assertTrue(indexes.toString(), indexes.contains("liberiaemr_auditlog_type_idx"));
			assertTrue(indexes.toString(), indexes.contains("liberiaemr_auditlog_parent_idx"));
		});
	}

	private static void applyLiquibase(Connection connection) throws SQLException {
		try {
			Database database = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(
			    new JdbcConnection(connection));
			File classes = new File(AuditLogStore.class.getProtectionDomain().getCodeSource().getLocation().toURI());
			new Liquibase("liquibase.xml", new FileSystemResourceAccessor(classes), database).update(new Contexts());
		}
		catch (Exception e) {
			throw new SQLException("could not apply liquibase.xml", e);
		}
	}
}
