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

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.openmrs.module.liberiaemr.ContentUuids;

/**
 * The facility a patient record came from, as {@code openmrs_identity.patient_link} stores it in
 * {@code facility_location_uuid} (ADR 0005).
 * <p>
 * The record's location is that of its preferred live identifier (a record whose identifiers are
 * all voided, a voided patient's, falls back to the one it had). Its facility is the NEAREST
 * ancestor-or-self of that location tagged Health Facility, compared by the tag's UUID: the rule
 * the ETL's {@code mamba_dim_location_hierarchy.facility_location_id} applies. Under the MFL
 * hierarchy (ADR 0009: facility, district, county, national) the root of the tree is the county
 * or the country, never the facility, which is what this used to store. No tagged ancestor
 * within {@value #MAX_HOPS} hops, or a cycle in {@code parent_location}, gives null.
 * <p>
 * The location tree is read once into memory: locations are metadata and few, and the backfill
 * resolves a location for every link.
 */
final class FacilityOfOrigin {

	/** How far up the tree the walk goes from the record's location; the MFL tree is five deep. */
	static final int MAX_HOPS = 10;

	/** Links read and rewritten per page by {@link #backfill}. */
	static final int BACKFILL_PAGE = 5000;

	/** The record's location: the preferred live identifier's, else the one a voided record had. */
	private static String recordLocationSql(String patientId) {
		return "SELECT pi.location_id FROM patient_identifier pi WHERE pi.patient_id = " + patientId
		        + " AND pi.location_id IS NOT NULL ORDER BY pi.voided, pi.preferred DESC, pi.patient_identifier_id LIMIT 1";
	}

	private final Map<Integer, Integer> parents = new HashMap<Integer, Integer>();

	private final Map<Integer, String> uuids = new HashMap<Integer, String>();

	private final Set<Integer> facilities = new HashSet<Integer>();

	private FacilityOfOrigin() {
	}

	/** @return the Health Facility tag's UUID, from the national variables.properties */
	static String healthFacilityTagUuid() {
		return ContentUuids.get(ContentUuids.LOCATION_TAG_HEALTH_FACILITY);
	}

	/** Reads the location tree and which locations carry the tag. */
	static FacilityOfOrigin load(Connection connection, String facilityTagUuid) throws SQLException {
		FacilityOfOrigin tree = new FacilityOfOrigin();
		for (Map<String, Object> row : IdentityService.query(connection,
		    "SELECT location_id, uuid, parent_location FROM location")) {
			Integer id = ((Number) row.get("location_id")).intValue();
			tree.uuids.put(id, (String) row.get("uuid"));
			if (row.get("parent_location") != null) {
				tree.parents.put(id, ((Number) row.get("parent_location")).intValue());
			}
		}
		for (Map<String, Object> row : IdentityService.query(connection, "SELECT m.location_id FROM location_tag_map m "
		        + "JOIN location_tag t ON t.location_tag_id = m.location_tag_id WHERE t.uuid = ?", facilityTagUuid)) {
			tree.facilities.add(((Number) row.get("location_id")).intValue());
		}
		return tree;
	}

	/**
	 * @param locationId a location, or null
	 * @return the UUID of its nearest ancestor-or-self tagged Health Facility, or null when there
	 *         is none within {@value #MAX_HOPS} hops
	 */
	String facilityOf(Integer locationId) {
		Set<Integer> seen = new HashSet<Integer>();
		Integer id = locationId;
		for (int hop = 0; hop <= MAX_HOPS && id != null && uuids.containsKey(id) && seen.add(id); hop++) {
			if (facilities.contains(id)) {
				return uuids.get(id);
			}
			id = parents.get(id);
		}
		return null;
	}

	/** @return the facility of origin of the patient's record, or null */
	String facilityOfRecord(Connection connection, int patientId) throws SQLException {
		return facilityOf(recordLocation(connection, patientId));
	}

	static Integer recordLocation(Connection connection, int patientId) throws SQLException {
		List<Map<String, Object>> rows = IdentityService.query(connection, recordLocationSql("?"), patientId);
		return rows.isEmpty() ? null : ((Number) rows.get(0).get("location_id")).intValue();
	}

	/**
	 * Recomputes {@code facility_location_uuid} on every link with the rule above, writing only the
	 * rows whose value changes, so a second run writes nothing. Reads and writes only the identity
	 * schema and the location, identifier and person tables; logs nothing about a record.
	 *
	 * @return {links read, links changed}
	 */
	static int[] backfill(Connection connection, String facilityTagUuid) throws SQLException {
		FacilityOfOrigin tree = load(connection, facilityTagUuid);
		int read = 0, changed = 0, after = 0;
		while (true) {
			List<Map<String, Object>> page = IdentityService.query(connection, "SELECT l.link_id, l.facility_location_uuid, "
			        + "(" + recordLocationSql("per.person_id") + ") AS location_id "
			        + "FROM " + IdentityService.SCHEMA + ".patient_link l LEFT JOIN person per ON per.uuid = l.patient_uuid "
			        + "WHERE l.link_id > ? ORDER BY l.link_id LIMIT " + BACKFILL_PAGE, after);
			if (page.isEmpty()) {
				break;
			}
			try (PreparedStatement update = connection.prepareStatement("UPDATE " + IdentityService.SCHEMA
			        + ".patient_link SET facility_location_uuid = ? WHERE link_id = ?")) {
				int batched = 0;
				for (Map<String, Object> row : page) {
					int linkId = ((Number) row.get("link_id")).intValue();
					Object location = row.get("location_id");
					String facility = tree.facilityOf(location == null ? null : ((Number) location).intValue());
					String stored = row.get("facility_location_uuid") == null ? null
					        : row.get("facility_location_uuid").toString().trim();
					if (facility == null ? stored != null : !facility.equals(stored)) {
						update.setString(1, facility);
						update.setInt(2, linkId);
						update.addBatch();
						batched++;
					}
					after = linkId;
				}
				if (batched > 0) {
					update.executeBatch();
				}
				read += page.size();
				changed += batched;
			}
			if (page.size() < BACKFILL_PAGE) {
				break;
			}
		}
		return new int[] { read, changed };
	}
}
