/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.remotehistory;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import liquibase.Contexts;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.FileSystemResourceAccessor;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.liberiaemr.remotehistory.RemoteHistoryStore.CachedSource;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/** The cache and audit tables as created by liquibase.xml, on the test database. */
public class RemoteHistoryStoreTest extends BaseModuleContextSensitiveTest {

	private static final String PATIENT = "11111111-1111-1111-1111-111111111111";

	private static final String OTHER = "22222222-2222-2222-2222-222222222222";

	private DbSessionFactory sessions;

	private RemoteHistoryStore store;

	@Before
	public void setUp() {
		sessions = Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class);
		store = new RemoteHistoryStore();
		store.setSessionFactory(sessions);
		sessions.getCurrentSession().doWork(RemoteHistoryStoreTest::applyLiquibase);
	}

	private static CachedSource source(String facility, String json, Date when) {
		return new CachedSource(facility, facility == null ? null : facility + " name", json, "h-" + json.length(), when);
	}

	@Test
	public void replacingKeepsOnlyTheLatestFetch() {
		Date first = new Date(System.currentTimeMillis() - 60000);
		store.replaceForPatient(PATIENT, Arrays.asList(source("careysburg", "{\"a\":1}", first),
		    source("barnersville", "{\"b\":1}", first)));
		Date second = new Date();
		store.replaceForPatient(PATIENT, Collections.singletonList(source("barnersville", "{\"b\":2}", second)));

		List<CachedSource> cached = store.findByPatient(PATIENT);

		assertEquals(1, cached.size());
		assertEquals("barnersville", cached.get(0).getSourceFacilityUuid());
		assertEquals("{\"b\":2}", cached.get(0).getBundleJson());
	}

	@Test
	public void anUnattributedSourceRoundTripsAsNull() {
		store.replaceForPatient(PATIENT, Collections.singletonList(source(null, "{}", new Date())));

		assertNull(store.findByPatient(PATIENT).get(0).getSourceFacilityUuid());
	}

	@Test
	public void anEmptyAnswerClearsTheCache() {
		store.replaceForPatient(PATIENT, Collections.singletonList(source("careysburg", "{}", new Date())));
		store.replaceForPatient(PATIENT, new ArrayList<CachedSource>());

		assertTrue(store.findByPatient(PATIENT).isEmpty());
	}

	@Test
	public void patientsAreKeptApart() {
		store.replaceForPatient(PATIENT, Collections.singletonList(source("careysburg", "{}", new Date())));

		assertTrue(store.findByPatient(OTHER).isEmpty());
	}

	@Test
	public void theCacheAgeComesFromTheLastAnswerIncludingAnEmptyOne() {
		Date older = new Date(System.currentTimeMillis() - 3600000L);
		Date newer = new Date(System.currentTimeMillis() - 60000L);
		assertNull(store.lastSuccessfulFetch(PATIENT));

		store.logFetch(1, PATIENT, "referral in", RemoteHistoryStore.OK, 4, older);
		store.logFetch(1, PATIENT, "routine refresh", RemoteHistoryStore.EMPTY, 0, newer);
		store.logFetch(1, PATIENT, "routine refresh", RemoteHistoryStore.UNREACHABLE, 0, new Date());
		store.logFetch(1, PATIENT, "routine refresh", RemoteHistoryStore.CACHED, 0, new Date());

		// Seconds are enough: the database may drop the milliseconds.
		assertEquals(newer.getTime() / 1000, store.lastSuccessfulFetch(PATIENT).getTime() / 1000);
	}

	@Test
	public void aPatientIsImportedByAShellOrAUserReasonButNotByRoutineRefreshes() {
		store.logFetch(1, PATIENT, RemoteHistoryStore.ROUTINE_REFRESH, RemoteHistoryStore.OK, 2, new Date());
		assertFalse(store.wasImported(PATIENT));

		store.logFetch(1, PATIENT, "Visiting patient", RemoteHistoryStore.SHELL, 0, new Date());
		assertTrue(store.wasImported(PATIENT));

		store.logFetch(1, OTHER, "Referral in", RemoteHistoryStore.OK, 3, new Date());
		assertTrue(store.wasImported(OTHER));
	}

	@Test
	public void everyAccessIsAuditedWithItsReasonAndOutcome() throws Exception {
		store.logFetch(1, PATIENT, "referral in", RemoteHistoryStore.OK, 3, new Date());
		store.logFetch(null, PATIENT, "routine refresh", RemoteHistoryStore.CACHED, 3, new Date());

		final List<String> rows = new ArrayList<String>();
		sessions.getCurrentSession().doWork(connection -> {
			try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(
			    "SELECT user_id, reason, outcome, resource_count FROM liberiaemr_remote_history_fetch "
			            + "WHERE patient_uuid = '" + PATIENT + "' ORDER BY fetch_id")) {
				while (rs.next()) {
					rows.add(rs.getObject(1) + "|" + rs.getString(2) + "|" + rs.getString(3) + "|" + rs.getInt(4));
				}
			}
		});

		assertEquals(Arrays.asList("1|referral in|OK|3", "null|routine refresh|CACHED|3"), rows);
	}

	private static void applyLiquibase(Connection connection) throws SQLException {
		try {
			Database database = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
			File classes = new File(RemoteHistoryStore.class.getProtectionDomain().getCodeSource().getLocation().toURI());
			new Liquibase("liquibase.xml", new FileSystemResourceAccessor(classes), database).update(new Contexts());
		}
		catch (Exception e) {
			throw new SQLException("could not apply liquibase.xml", e);
		}
	}
}
