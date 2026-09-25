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
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Central Person Identifier (sync-eip.md 2.5, ADR 0005). Every patient central receives
 * gets a CPI on first sight; an exact National ID match with agreeing sex and date of birth
 * makes the new CPI an alias of the existing one. Records are linked, never merged, and the
 * OpenMRS replica is never written. Everything lives in the identity schema, which only
 * central has.
 */
@Component("liberiaemr.IdentityService")
public class IdentityService {

	private static final Logger log = LoggerFactory.getLogger(IdentityService.class);

	public static final String SCHEMA = "openmrs_identity";

	public static final String GP_NATIONAL_ID_TYPE = "liberiaemr.identity.nationalIdTypeUuid";

	public static final String GP_DOB_TOLERANCE_DAYS = "liberiaemr.identity.dobToleranceDays";

	public static final String GP_BATCH_SIZE = "liberiaemr.identity.batchSize";

	public static final String BASIS_NEW = "NEW";

	public static final String BASIS_NATIONAL_ID = "NATIONAL_ID";

	public static final String EVENT_MINTED = "MINTED";

	public static final String EVENT_ALIASED = "ALIASED";

	public static final String REVIEW_OPEN = "OPEN";

	/** How many links each run compares for a changed National ID; a million take about three hours. */
	static final int RECHECK_SLICE = 5000;

	private volatile int recheckCursor = 0;

	/** No link yet for the record; central has not seen it, or the task has not run. */
	public static class NotFoundException extends RuntimeException {

		public NotFoundException(String message) {
			super(message);
		}
	}

	@Autowired
	private DbSessionFactory sessionFactory;

	@Transactional(readOnly = true)
	public boolean isEnabled() {
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Boolean>() {

			@Override
			public Boolean execute(Connection connection) throws SQLException {
				return schemaReady(connection);
			}
		});
	}

	/**
	 * Assigns a CPI to every patient that has none, up to the batch size, then applies the
	 * National ID rule to each.
	 *
	 * @return enabled, assigned, linked, forReview
	 */
	@Transactional
	public Map<String, Object> assignPending() {
		final Map<String, Object> result = new LinkedHashMap<String, Object>();
		final String nationalIdType = gp(GP_NATIONAL_ID_TYPE, "");
		final int tolerance = Integer.parseInt(gp(GP_DOB_TOLERANCE_DAYS, "0").trim());
		final int batch = Integer.parseInt(gp(GP_BATCH_SIZE, "200").trim());
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				if (!schemaReady(connection)) {
					result.put("enabled", false);
					return result;
				}
				int assigned = 0, linked = 0, forReview = 0;
				for (Map<String, Object> patient : query(connection,
				    "SELECT p.patient_id, per.uuid, per.gender, per.birthdate, per.birthdate_estimated "
				            + "FROM patient p JOIN person per ON per.person_id = p.patient_id "
				            + "LEFT JOIN " + SCHEMA + ".patient_link l ON l.patient_uuid = per.uuid "
				            + "WHERE l.link_id IS NULL AND p.voided = 0 ORDER BY p.patient_id LIMIT " + batch)) {
					int cpiId = mint(connection, patient);
					assigned++;
					String outcome = linkOnNationalId(connection, patient, cpiId, nationalIdType, tolerance);
					if (BASIS_NATIONAL_ID.equals(outcome)) {
						linked++;
					} else if (REVIEW_OPEN.equals(outcome)) {
						forReview++;
					}
				}
				// A National ID added or corrected after the record got its CPI is checked again. The
				// facility's timestamps cannot say when central last looked, so each run compares the
				// value on a slice of the links and the sweep wraps round.
				if (!nationalIdType.isEmpty()) {
					List<Map<String, Object>> slice = query(connection, "SELECT l.link_id, l.cpi_id, l.national_id AS checked, "
					        + "per.person_id AS patient_id, per.uuid, per.gender, per.birthdate, per.birthdate_estimated, "
					        + "(SELECT x.identifier FROM patient_identifier x JOIN patient_identifier_type t "
					        + "ON t.patient_identifier_type_id = x.identifier_type WHERE x.patient_id = per.person_id AND t.uuid = ? "
					        + "AND x.voided = 0 ORDER BY x.preferred DESC, x.patient_identifier_id LIMIT 1) AS current "
					        + "FROM " + SCHEMA + ".patient_link l JOIN person per ON per.uuid = l.patient_uuid "
					        + "WHERE l.link_id > ? AND per.voided = 0 ORDER BY l.link_id LIMIT " + RECHECK_SLICE, nationalIdType,
					    recheckCursor);
					recheckCursor = slice.size() < RECHECK_SLICE ? 0
					        : ((Number) slice.get(slice.size() - 1).get("link_id")).intValue();
					for (Map<String, Object> patient : slice) {
						String current = patient.get("current") == null ? "" : patient.get("current").toString().trim();
						String checked = patient.get("checked") == null ? "" : patient.get("checked").toString();
						if (current.equals(checked)) {
							continue;
						}
						String outcome = recheck(connection, patient, current, nationalIdType, tolerance);
						if (BASIS_NATIONAL_ID.equals(outcome)) {
							linked++;
						} else if (REVIEW_OPEN.equals(outcome)) {
							forReview++;
						}
					}
				}
				result.put("enabled", true);
				result.put("assigned", assigned);
				result.put("linked", linked);
				result.put("forReview", forReview);
				return result;
			}
		});
	}

	/**
	 * @return the record's CPI, the person it resolves to, every record linked to that person and
	 *         any open review involving it
	 * @throws NotFoundException when the record has no CPI yet
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> resolve(final String patientUuid) {
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				if (!schemaReady(connection)) {
					throw new NotFoundException("there is no identity service on this server");
				}
				List<Map<String, Object>> links = query(connection, "SELECT l.cpi_id, c.cpi, c.code FROM " + SCHEMA
				        + ".patient_link l JOIN " + SCHEMA + ".cpi c ON c.cpi_id = l.cpi_id WHERE l.patient_uuid = ?",
				    patientUuid);
				if (links.isEmpty()) {
					throw new NotFoundException("no CPI has been assigned to " + patientUuid + " yet");
				}
				int own = ((Number) links.get(0).get("cpi_id")).intValue();
				Map<String, Object> primary = primaryOf(connection, own);
				int primaryId = ((Number) primary.get("cpi_id")).intValue();

				Map<String, Object> out = new LinkedHashMap<String, Object>();
				out.put("patientUuid", patientUuid);
				out.put("cpi", primary.get("cpi"));
				out.put("code", primary.get("code"));
				out.put("recordCpi", links.get(0).get("cpi"));
				out.put("recordCode", links.get(0).get("code"));
				out.put("alias", own != primaryId);

				List<Map<String, Object>> records = new ArrayList<Map<String, Object>>();
				for (Map<String, Object> row : query(connection,
				    "SELECT l.patient_uuid, l.facility_location_uuid, l.basis, l.date_created, c.code FROM " + SCHEMA
				            + ".patient_link l JOIN " + SCHEMA + ".cpi c ON c.cpi_id = l.cpi_id WHERE l.cpi_id IN ("
				            + ids(aliasTree(connection, primaryId)) + ") ORDER BY l.link_id")) {
					Map<String, Object> record = new LinkedHashMap<String, Object>();
					record.put("patientUuid", row.get("patient_uuid"));
					record.put("facility", locationName(connection, (String) row.get("facility_location_uuid")));
					record.put("recordCode", row.get("code"));
					record.put("basis", row.get("basis"));
					record.put("dateLinked", millis(row.get("date_created")));
					records.add(record);
				}
				out.put("records", records);

				List<Map<String, Object>> reviews = new ArrayList<Map<String, Object>>();
				for (Map<String, Object> row : query(connection, "SELECT review_id, patient_uuid, candidate_patient_uuid, "
				        + "reason, date_created FROM " + SCHEMA + ".match_review WHERE status = 'OPEN' "
				        + "AND (patient_uuid = ? OR candidate_patient_uuid = ?) ORDER BY review_id", patientUuid,
				    patientUuid)) {
					Map<String, Object> review = new LinkedHashMap<String, Object>();
					review.put("id", ((Number) row.get("review_id")).intValue());
					review.put("otherPatientUuid", patientUuid.equals(row.get("patient_uuid")) ? row.get("candidate_patient_uuid")
					        : row.get("patient_uuid"));
					review.put("reason", row.get("reason"));
					review.put("raised", millis(row.get("date_created")));
					reviews.add(review);
				}
				out.put("openReviews", reviews);
				return out;
			}
		});
	}

	/**
	 * @return counts for the status page: people, records, records linked to another, open
	 *         reviews and records still waiting for a CPI
	 */
	@Transactional(readOnly = true)
	public Map<String, Object> status() {
		return sessionFactory.getCurrentSession().doReturningWork(new ReturningWork<Map<String, Object>>() {

			@Override
			public Map<String, Object> execute(Connection connection) throws SQLException {
				Map<String, Object> out = new LinkedHashMap<String, Object>();
				if (!schemaReady(connection)) {
					out.put("enabled", false);
					return out;
				}
				out.put("enabled", true);
				out.put("people", count(connection, "SELECT COUNT(*) FROM " + SCHEMA + ".cpi WHERE primary_cpi_id IS NULL"));
				out.put("records", count(connection, "SELECT COUNT(*) FROM " + SCHEMA + ".patient_link"));
				out.put("linked", count(connection, "SELECT COUNT(*) FROM " + SCHEMA + ".cpi WHERE primary_cpi_id IS NOT NULL"));
				out.put("openReviews", count(connection, "SELECT COUNT(*) FROM " + SCHEMA + ".match_review WHERE status = 'OPEN'"));
				out.put("unassigned", count(connection, "SELECT COUNT(*) FROM patient p JOIN person per ON per.person_id = p.patient_id "
				        + "LEFT JOIN " + SCHEMA + ".patient_link l ON l.patient_uuid = per.uuid WHERE l.link_id IS NULL AND p.voided = 0"));
				return out;
			}
		});
	}

	/** Mints a CPI for the patient, records the event and the link. */
	private int mint(Connection connection, Map<String, Object> patient) throws SQLException {
		int patientId = ((Number) patient.get("patient_id")).intValue();
		String patientUuid = (String) patient.get("uuid");
		Timestamp now = new Timestamp(System.currentTimeMillis());
		int cpiId = -1;
		for (int attempt = 0; attempt < 5 && cpiId < 0; attempt++) {
			String code = CpiCode.generate();
			if (!query(connection, "SELECT cpi_id FROM " + SCHEMA + ".cpi WHERE code = ?", code).isEmpty()) {
				continue;
			}
			cpiId = insert(connection, "INSERT INTO " + SCHEMA + ".cpi (cpi, code, date_created) VALUES (?, ?, ?)",
			    UUID.randomUUID().toString(), code, now);
		}
		if (cpiId < 0) {
			throw new SQLException("could not find an unused CPI code in five attempts");
		}
		insert(connection, "INSERT INTO " + SCHEMA + ".cpi_event (cpi_id, kind, reason, date_created) VALUES (?, ?, ?, ?)",
		    cpiId, EVENT_MINTED, "Record received at central", now);
		insert(connection, "INSERT INTO " + SCHEMA
		        + ".patient_link (patient_uuid, cpi_id, facility_location_uuid, basis, date_created) VALUES (?, ?, ?, ?, ?)",
		    patientUuid, cpiId, facilityLocation(connection, patientId), BASIS_NEW, now);
		return cpiId;
	}

	/**
	 * The deterministic rule of ADR 0005: the same National ID on another record links the two,
	 * but only when sex and date of birth agree; otherwise the pair waits for a person.
	 *
	 * @return NATIONAL_ID when linked, OPEN when a review was raised, else null
	 */
	private String linkOnNationalId(Connection connection, Map<String, Object> patient, int cpiId, String nationalIdType,
	        int toleranceDays) throws SQLException {
		if (nationalIdType.isEmpty()) {
			return null;
		}
		int patientId = ((Number) patient.get("patient_id")).intValue();
		String patientUuid = (String) patient.get("uuid");
		List<Map<String, Object>> ids = query(connection, "SELECT pi.identifier FROM patient_identifier pi "
		        + "JOIN patient_identifier_type t ON t.patient_identifier_type_id = pi.identifier_type "
		        + "WHERE pi.patient_id = ? AND pi.voided = 0 AND t.uuid = ? ORDER BY pi.preferred DESC, pi.patient_identifier_id",
		    patientId, nationalIdType);
		if (ids.isEmpty()) {
			return null;
		}
		String nationalId = String.valueOf(ids.get(0).get("identifier")).trim();
		update(connection, "UPDATE " + SCHEMA + ".patient_link SET national_id = ? WHERE patient_uuid = ?", nationalId,
		    patientUuid);
		if (nationalId.isEmpty()) {
			return null;
		}
		int ownPrimary = ((Number) primaryOf(connection, cpiId).get("cpi_id")).intValue();
		String outcome = null;
		for (Map<String, Object> other : query(connection, "SELECT per.uuid, per.gender, per.birthdate, per.birthdate_estimated, "
		        + "l.cpi_id FROM patient_identifier pi "
		        + "JOIN patient_identifier_type t ON t.patient_identifier_type_id = pi.identifier_type "
		        + "JOIN person per ON per.person_id = pi.patient_id "
		        + "JOIN " + SCHEMA + ".patient_link l ON l.patient_uuid = per.uuid "
		        + "WHERE t.uuid = ? AND pi.identifier = ? AND pi.voided = 0 AND per.voided = 0 AND per.uuid <> ? ORDER BY l.link_id",
		    nationalIdType, nationalId, patientUuid)) {
			int primaryId = ((Number) primaryOf(connection, ((Number) other.get("cpi_id")).intValue()).get("cpi_id")).intValue();
			if (primaryId == ownPrimary) {
				continue;
			}
			String disagreement = disagreement(patient, other, toleranceDays);
			if (disagreement == null) {
				alias(connection, cpiId, primaryId, "National ID matches record " + other.get("uuid")
				        + "; sex and date of birth agree");
				update(connection, "UPDATE " + SCHEMA + ".patient_link SET basis = ? WHERE patient_uuid = ?", BASIS_NATIONAL_ID,
				    patientUuid);
				return BASIS_NATIONAL_ID;
			}
			// Never auto-link on a National ID that disagrees with the person it names; a person
			// decides (sync-eip.md 2.2 rule 4).
			outcome = raiseReview(connection, patientUuid, (String) other.get("uuid"), "National ID matches but " + disagreement);
		}
		return outcome;
	}

	/**
	 * A record on its own takes the National ID rule afresh. One already linked to others is never
	 * moved by a changed National ID, since that would carry the whole group with it; a person
	 * checks the link instead.
	 */
	private String recheck(Connection connection, Map<String, Object> patient, String nationalId, String nationalIdType,
	        int toleranceDays) throws SQLException {
		String patientUuid = (String) patient.get("uuid");
		int cpiId = ((Number) patient.get("cpi_id")).intValue();
		int primaryId = ((Number) primaryOf(connection, cpiId).get("cpi_id")).intValue();
		Set<Integer> group = aliasTree(connection, primaryId);
		if (group.size() == 1) {
			if (nationalId.isEmpty()) {
				update(connection, "UPDATE " + SCHEMA + ".patient_link SET national_id = ? WHERE patient_uuid = ?", "", patientUuid);
				return null;
			}
			return linkOnNationalId(connection, patient, cpiId, nationalIdType, toleranceDays);
		}
		update(connection, "UPDATE " + SCHEMA + ".patient_link SET national_id = ? WHERE patient_uuid = ?", nationalId, patientUuid);
		List<Map<String, Object>> others = query(connection, "SELECT patient_uuid FROM " + SCHEMA + ".patient_link WHERE cpi_id IN ("
		        + ids(group) + ") AND patient_uuid <> ? ORDER BY link_id LIMIT 1", patientUuid);
		return others.isEmpty() ? null : raiseReview(connection, patientUuid, (String) others.get(0).get("patient_uuid"),
		    "National ID changed after the record was linked; check the link still holds");
	}

	/** Opens a review for the pair unless one is already open. */
	private String raiseReview(Connection connection, String patientUuid, String otherUuid, String reason) throws SQLException {
		if (query(connection, "SELECT review_id FROM " + SCHEMA + ".match_review WHERE status = ? AND "
		        + "((patient_uuid = ? AND candidate_patient_uuid = ?) OR (patient_uuid = ? AND candidate_patient_uuid = ?))",
		    REVIEW_OPEN, patientUuid, otherUuid, otherUuid, patientUuid).isEmpty()) {
			insert(connection, "INSERT INTO " + SCHEMA
			        + ".match_review (patient_uuid, candidate_patient_uuid, reason, status, date_created) VALUES (?, ?, ?, ?, ?)",
			    patientUuid, otherUuid, reason, REVIEW_OPEN, new Timestamp(System.currentTimeMillis()));
		}
		return REVIEW_OPEN;
	}

	/** @return null when sex and date of birth agree, else what disagrees */
	static String disagreement(Map<String, Object> a, Map<String, Object> b, int toleranceDays) {
		String sexA = text(a.get("gender")), sexB = text(b.get("gender"));
		if (sexA == null || sexB == null) {
			return "sex is not recorded on both";
		}
		if (!sexA.equalsIgnoreCase(sexB)) {
			return "sex differs";
		}
		LocalDate dobA = date(a.get("birthdate")), dobB = date(b.get("birthdate"));
		if (dobA == null || dobB == null) {
			return "date of birth is not recorded on both";
		}
		boolean estimated = truthy(a.get("birthdate_estimated")) || truthy(b.get("birthdate_estimated"));
		if (estimated) {
			return dobA.getYear() == dobB.getYear() ? null : "estimated dates of birth are in different years";
		}
		return Math.abs(ChronoUnit.DAYS.between(dobA, dobB)) <= toleranceDays ? null : "date of birth differs";
	}

	/** Makes cpiId an alias of primaryId, recording the event. */
	private void alias(Connection connection, int cpiId, int primaryId, String reason) throws SQLException {
		if (cpiId == primaryId) {
			return;
		}
		Timestamp now = new Timestamp(System.currentTimeMillis());
		update(connection, "UPDATE " + SCHEMA + ".cpi SET primary_cpi_id = ?, date_changed = ?, change_reason = ? WHERE cpi_id = ?",
		    primaryId, now, reason, cpiId);
		insert(connection, "INSERT INTO " + SCHEMA
		        + ".cpi_event (cpi_id, kind, primary_before, primary_after, reason, date_created) VALUES (?, ?, NULL, ?, ?, ?)",
		    cpiId, EVENT_ALIASED, primaryId, reason, now);
	}

	/** Follows aliases to the CPI that stands for the person. */
	private Map<String, Object> primaryOf(Connection connection, int cpiId) throws SQLException {
		Map<String, Object> row = null;
		int id = cpiId;
		for (int hop = 0; hop < 20; hop++) {
			row = query(connection, "SELECT cpi_id, cpi, code, primary_cpi_id FROM " + SCHEMA + ".cpi WHERE cpi_id = ?", id).get(0);
			if (row.get("primary_cpi_id") == null) {
				return row;
			}
			id = ((Number) row.get("primary_cpi_id")).intValue();
		}
		throw new SQLException("CPI alias chain from " + cpiId + " does not end");
	}

	/** The primary and every CPI that resolves to it. */
	private Set<Integer> aliasTree(Connection connection, int primaryId) throws SQLException {
		Set<Integer> tree = new LinkedHashSet<Integer>();
		tree.add(primaryId);
		int before;
		do {
			before = tree.size();
			for (Map<String, Object> row : query(connection, "SELECT cpi_id FROM " + SCHEMA + ".cpi WHERE primary_cpi_id IN ("
			        + ids(tree) + ")")) {
				tree.add(((Number) row.get("cpi_id")).intValue());
			}
		} while (tree.size() > before);
		return tree;
	}

	/** The facility a record came from: the top of the location tree its identifier was issued at. */
	private String facilityLocation(Connection connection, int patientId) throws SQLException {
		List<Map<String, Object>> rows = query(connection, "SELECT location_id FROM patient_identifier WHERE patient_id = ? "
		        + "AND voided = 0 AND location_id IS NOT NULL ORDER BY preferred DESC, patient_identifier_id", patientId);
		if (rows.isEmpty()) {
			return null;
		}
		int id = ((Number) rows.get(0).get("location_id")).intValue();
		for (int hop = 0; hop < 10; hop++) {
			Map<String, Object> location = query(connection, "SELECT uuid, parent_location FROM location WHERE location_id = ?", id)
			        .get(0);
			if (location.get("parent_location") == null) {
				return (String) location.get("uuid");
			}
			id = ((Number) location.get("parent_location")).intValue();
		}
		return null;
	}

	private String locationName(Connection connection, String uuid) throws SQLException {
		if (uuid == null) {
			return null;
		}
		List<Map<String, Object>> rows = query(connection, "SELECT name FROM location WHERE uuid = ?", uuid);
		return rows.isEmpty() ? null : (String) rows.get(0).get("name");
	}

	/** True when the schema exists and liquibase has created its tables. */
	private static boolean schemaReady(Connection connection) throws SQLException {
		return count(connection, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '" + SCHEMA
		        + "' AND table_name = 'match_review'") > 0;
	}

	private static String gp(String name, String fallback) {
		String value = Context.getAdministrationService().getGlobalProperty(name);
		return value == null || value.trim().isEmpty() ? fallback : value;
	}

	private static String ids(Set<Integer> ids) {
		StringBuilder out = new StringBuilder();
		for (Integer id : ids) {
			out.append(out.length() == 0 ? "" : ",").append(id);
		}
		return out.toString();
	}

	private static String text(Object value) {
		return value == null || value.toString().trim().isEmpty() ? null : value.toString().trim();
	}

	private static LocalDate date(Object value) {
		if (value instanceof java.sql.Date) {
			return ((java.sql.Date) value).toLocalDate();
		}
		if (value instanceof java.sql.Timestamp) {
			return ((java.sql.Timestamp) value).toLocalDateTime().toLocalDate();
		}
		if (value instanceof java.time.LocalDateTime) {
			return ((java.time.LocalDateTime) value).toLocalDate();
		}
		if (value instanceof LocalDate) {
			return (LocalDate) value;
		}
		return null;
	}

	private static boolean truthy(Object value) {
		return value instanceof Boolean ? (Boolean) value : value instanceof Number && ((Number) value).intValue() != 0;
	}

	private static Long millis(Object value) {
		if (value instanceof java.time.LocalDateTime) {
			return ((java.time.LocalDateTime) value).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
		}
		return value instanceof java.util.Date ? ((java.util.Date) value).getTime() : null;
	}

	private static int count(Connection connection, String sql) throws SQLException {
		try (Statement statement = connection.createStatement(); ResultSet results = statement.executeQuery(sql)) {
			results.next();
			return results.getInt(1);
		}
	}

	private static int insert(Connection connection, String sql, Object... params) throws SQLException {
		try (PreparedStatement statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
			for (int i = 0; i < params.length; i++) {
				statement.setObject(i + 1, params[i]);
			}
			statement.executeUpdate();
			try (ResultSet keys = statement.getGeneratedKeys()) {
				return keys.next() ? keys.getInt(1) : -1;
			}
		}
	}

	private static void update(Connection connection, String sql, Object... params) throws SQLException {
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			for (int i = 0; i < params.length; i++) {
				statement.setObject(i + 1, params[i]);
			}
			statement.executeUpdate();
		}
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
