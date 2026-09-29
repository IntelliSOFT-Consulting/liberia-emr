/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;

import org.hibernate.jdbc.ReturningWork;
import org.hibernate.jdbc.Work;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.Location;
import org.openmrs.LocationTag;
import org.openmrs.api.LocationService;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/**
 * The facility of origin a CPI link records (LE-370): the nearest ancestor-or-self tagged Health
 * Facility, not the root of the tree, and the changeset that rewrites the links minted before.
 * The tree is the MFL one (ADR 0009): national, county, district, facility, then the facility's
 * own wards.
 */
public class FacilityOfOriginTest extends BaseModuleContextSensitiveTest {

	private static final int PATIENT_AT_WARD = 2;

	private static final int PATIENT_AT_FACILITY = 6;

	private static final int PATIENT_OUTSIDE = 7;

	private LocationService locations;

	private Location national, county, district, facility, ward, outside;

	@Before
	public void tree() {
		// DDL commits in H2, so the identity table is made before this test writes anything.
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.execute("CREATE SCHEMA IF NOT EXISTS " + IdentityService.SCHEMA);
					s.execute("CREATE TABLE IF NOT EXISTS " + IdentityService.SCHEMA + ".patient_link (link_id INT "
					        + "AUTO_INCREMENT PRIMARY KEY, patient_uuid CHAR(38) NOT NULL, cpi_id INT NOT NULL, "
					        + "facility_location_uuid CHAR(38), basis VARCHAR(30) NOT NULL, date_created TIMESTAMP NOT NULL)");
				}
			}
		});
		locations = Context.getLocationService();
		String tagUuid = ContentUuids.get(ContentUuids.LOCATION_TAG_HEALTH_FACILITY);
		LocationTag healthFacility = locations.getLocationTagByUuid(tagUuid);
		if (healthFacility == null) {
			healthFacility = new LocationTag("LE-370 Health Facility", "compared by UUID, never by name");
			healthFacility.setUuid(tagUuid);
			locations.saveLocationTag(healthFacility);
		}
		LocationTag other = locations.saveLocationTag(new LocationTag("LE-370 District", "not the facility tag"));

		national = location("LE-370 Liberia", null, null);
		county = location("LE-370 Montserrado", national, null);
		district = location("LE-370 Careysburg District", county, other);
		facility = location("LE-370 Careysburg Health Center", district, healthFacility);
		ward = location("LE-370 Careysburg Inpatient Ward", facility, null);
		outside = location("LE-370 County Store", county, null);
		Context.flushSession();
	}

	private Location location(String name, Location parent, LocationTag tag) {
		Location location = new Location();
		location.setName(name);
		location.setParentLocation(parent);
		if (tag != null) {
			location.addTag(tag);
		}
		return locations.saveLocation(location);
	}

	private static void work(Work work) {
		Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class).getCurrentSession().doWork(work);
	}

	private static <T> T returning(ReturningWork<T> work) {
		return Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class).getCurrentSession()
		        .doReturningWork(work);
	}

	private static FacilityOfOrigin load() {
		return returning(new ReturningWork<FacilityOfOrigin>() {

			@Override
			public FacilityOfOrigin execute(Connection connection) throws SQLException {
				return FacilityOfOrigin.load(connection, FacilityOfOrigin.healthFacilityTagUuid());
			}
		});
	}

	/** Puts every identifier of the patient at the location, as registration there would. */
	private static void registeredAt(final int patientId, final Location location) {
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.executeUpdate("UPDATE patient_identifier SET location_id = " + location.getLocationId()
					        + " WHERE patient_id = " + patientId);
				}
			}
		});
	}

	private static String recordFacility(final int patientId) {
		final FacilityOfOrigin tree = load();
		return returning(new ReturningWork<String>() {

			@Override
			public String execute(Connection connection) throws SQLException {
				return tree.facilityOfRecord(connection, patientId);
			}
		});
	}

	@Test
	public void identifierAtAWardUnderTheFacility_givesTheFacility() {
		registeredAt(PATIENT_AT_WARD, ward);
		assertEquals(facility.getUuid(), recordFacility(PATIENT_AT_WARD));
		assertEquals(facility.getUuid(), load().facilityOf(ward.getLocationId()));
	}

	@Test
	public void identifierAtTheFacilityItself_givesTheFacility() {
		registeredAt(PATIENT_AT_FACILITY, facility);
		assertEquals(facility.getUuid(), recordFacility(PATIENT_AT_FACILITY));
	}

	@Test
	public void noTaggedAncestor_givesNull() {
		registeredAt(PATIENT_OUTSIDE, outside);
		assertEquals(outside.getLocationId(), returning(new ReturningWork<Integer>() {

			@Override
			public Integer execute(Connection connection) throws SQLException {
				return FacilityOfOrigin.recordLocation(connection, PATIENT_OUTSIDE);
			}
		}));
		assertNull(recordFacility(PATIENT_OUTSIDE));
		// neither the district above the facility nor the root of the tree is a facility
		assertNull(load().facilityOf(district.getLocationId()));
		assertNull(load().facilityOf(national.getLocationId()));
		assertNull(load().facilityOf(null));
	}

	@Test
	public void aCycleInParentLocation_endsTheWalk() {
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.executeUpdate("UPDATE location SET parent_location = " + outside.getLocationId() + " WHERE location_id = "
					        + county.getLocationId());
				}
			}
		});
		assertNull(load().facilityOf(outside.getLocationId()));
		assertEquals(facility.getUuid(), load().facilityOf(ward.getLocationId()));
	}

	@Test
	public void backfill_rewritesTheRootWithTheFacility_andIsIdempotent() throws Exception {
		registeredAt(PATIENT_AT_WARD, ward);
		registeredAt(PATIENT_AT_FACILITY, facility);
		registeredAt(PATIENT_OUTSIDE, outside);
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.executeUpdate("DELETE FROM " + IdentityService.SCHEMA + ".patient_link");
					// as minted before the fix: the root of the tree, the country
					link(s, PATIENT_AT_WARD, national.getUuid());
					// already right
					link(s, PATIENT_AT_FACILITY, facility.getUuid());
					// the root, where no facility is above the identifier's location
					link(s, PATIENT_OUTSIDE, national.getUuid());
				}
			}

			private void link(Statement s, int patientId, String facilityUuid) throws SQLException {
				s.executeUpdate("INSERT INTO " + IdentityService.SCHEMA + ".patient_link (patient_uuid, cpi_id, "
				        + "facility_location_uuid, basis, date_created) SELECT uuid, " + patientId + ", '" + facilityUuid
				        + "', 'NEW', CURRENT_TIMESTAMP FROM person WHERE person_id = " + patientId);
			}
		});

		assertEquals("Recomputed the facility of origin of 3 identity link(s); 2 changed", runChangeset());
		assertEquals(facility.getUuid(), stored(PATIENT_AT_WARD));
		assertEquals(facility.getUuid(), stored(PATIENT_AT_FACILITY));
		assertNull(stored(PATIENT_OUTSIDE));

		assertEquals("Recomputed the facility of origin of 3 identity link(s); 0 changed", runChangeset());
		assertArrayEquals(new int[] { 3, 0 }, returning(new ReturningWork<int[]>() {

			@Override
			public int[] execute(Connection connection) throws SQLException {
				return FacilityOfOrigin.backfill(connection, FacilityOfOrigin.healthFacilityTagUuid());
			}
		}));
	}

	/** Runs the changeset's custom change the way liquibase does, on this test's connection. */
	private static String runChangeset() {
		return returning(new ReturningWork<String>() {

			@Override
			public String execute(Connection connection) throws SQLException {
				try {
					Database database = DatabaseFactory.getInstance()
					        .findCorrectDatabaseImplementation(new JdbcConnection(connection));
					FacilityOfOriginBackfill change = new FacilityOfOriginBackfill();
					change.execute(database);
					return change.getConfirmationMessage();
				}
				catch (Exception e) {
					throw new IllegalStateException(e);
				}
			}
		});
	}

	private static String stored(final int patientId) {
		return returning(new ReturningWork<String>() {

			@Override
			public String execute(Connection connection) throws SQLException {
				List<Map<String, Object>> rows = IdentityService.query(connection, "SELECT l.facility_location_uuid FROM "
				        + IdentityService.SCHEMA + ".patient_link l JOIN person p ON p.uuid = l.patient_uuid "
				        + "WHERE p.person_id = ?", patientId);
				Object value = rows.get(0).get("facility_location_uuid");
				return value == null ? null : value.toString().trim();
			}
		});
	}
}
