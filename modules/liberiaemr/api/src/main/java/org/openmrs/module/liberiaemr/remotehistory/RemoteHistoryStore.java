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

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.hibernate.jdbc.ReturningWork;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The facility's cache of remote patient history (LE-384, ADR 0013): {@code liberiaemr_remote_history}
 * holds the scoped bundle central served, one row per patient and source facility, and
 * {@code liberiaemr_remote_history_fetch} audits every access. Plain tables, not OpenMRS entities,
 * and never synced: nothing here can be edited through OpenMRS or reach central.
 */
@Component("liberiaemr.RemoteHistoryStore")
public class RemoteHistoryStore {

	/** Fetch audit outcomes. */
	public static final String OK = "OK";

	public static final String EMPTY = "EMPTY";

	public static final String CACHED = "CACHED";

	public static final String UNREACHABLE = "UNREACHABLE";

	public static final String ERROR = "ERROR";

	/**
	 * A patient shell was imported and its history is fetched in a separate call (LE-387). Logged
	 * so the import is audited with its reason even if that call never comes. Not an answer from
	 * central's history endpoint, so it never counts towards the age of the cache.
	 */
	public static final String SHELL = "SHELL";

	/** The reason logged for fetches no user asked for (chart open, Refresh). */
	public static final String ROUTINE_REFRESH = "routine refresh";

	/** One cached source facility's bundle. */
	public static class CachedSource {

		private final String sourceFacilityUuid;

		private final String sourceFacilityName;

		private final String bundleJson;

		private final String contentHash;

		private final Date fetchedAt;

		public CachedSource(String sourceFacilityUuid, String sourceFacilityName, String bundleJson, String contentHash,
		    Date fetchedAt) {
			this.sourceFacilityUuid = sourceFacilityUuid;
			this.sourceFacilityName = sourceFacilityName;
			this.bundleJson = bundleJson;
			this.contentHash = contentHash;
			this.fetchedAt = fetchedAt;
		}

		/** @return the source facility's location UUID, or null when central could not attribute it */
		public String getSourceFacilityUuid() {
			return sourceFacilityUuid;
		}

		public String getSourceFacilityName() {
			return sourceFacilityName;
		}

		public String getBundleJson() {
			return bundleJson;
		}

		public String getContentHash() {
			return contentHash;
		}

		public Date getFetchedAt() {
			return fetchedAt;
		}
	}

	@Autowired
	private DbSessionFactory sessionFactory;

	void setSessionFactory(DbSessionFactory sessionFactory) {
		this.sessionFactory = sessionFactory;
	}

	/**
	 * Replaces everything cached for the patient with what central just served, in one transaction,
	 * so a reader never sees half of one fetch and half of another. An empty list clears the cache:
	 * central no longer shows anything for the patient.
	 */
	@Transactional
	public void replaceForPatient(final String patientUuid, final List<CachedSource> sources) {
		work(new ReturningWork<Void>() {

			@Override
			public Void execute(Connection connection) throws SQLException {
				try (PreparedStatement delete = connection
				        .prepareStatement("DELETE FROM liberiaemr_remote_history WHERE patient_uuid = ?")) {
					delete.setString(1, patientUuid);
					delete.executeUpdate();
				}
				try (PreparedStatement insert = connection.prepareStatement("INSERT INTO liberiaemr_remote_history "
				        + "(patient_uuid, source_facility_uuid, source_facility_name, bundle_json, content_hash, fetched_at) "
				        + "VALUES (?, ?, ?, ?, ?, ?)")) {
					for (CachedSource source : sources) {
						insert.setString(1, patientUuid);
						insert.setString(2, source.getSourceFacilityUuid() == null ? "" : source.getSourceFacilityUuid());
						insert.setString(3, source.getSourceFacilityName());
						insert.setString(4, source.getBundleJson());
						insert.setString(5, source.getContentHash());
						insert.setTimestamp(6, new Timestamp(source.getFetchedAt().getTime()));
						insert.addBatch();
					}
					insert.executeBatch();
				}
				return null;
			}
		});
	}

	/**
	 * @return whether the patient came here through Remote Search: an import logs its shell, or a
	 *         fetch with the user's reason; routine refreshes alone don't count
	 */
	@Transactional(readOnly = true)
	public boolean wasImported(final String patientUuid) {
		return work(new ReturningWork<Boolean>() {

			@Override
			public Boolean execute(Connection connection) throws SQLException {
				try (PreparedStatement select = connection.prepareStatement("SELECT 1 FROM liberiaemr_remote_history_fetch "
				        + "WHERE patient_uuid = ? AND (outcome = ? OR reason <> ?)")) {
					select.setString(1, patientUuid);
					select.setString(2, SHELL);
					select.setString(3, ROUTINE_REFRESH);
					select.setMaxRows(1);
					try (ResultSet rs = select.executeQuery()) {
						return rs.next();
					}
				}
			}
		});
	}

	/** @return the cached bundles for the patient, empty when none was ever fetched */
	@Transactional(readOnly = true)
	public List<CachedSource> findByPatient(final String patientUuid) {
		return work(new ReturningWork<List<CachedSource>>() {

			@Override
			public List<CachedSource> execute(Connection connection) throws SQLException {
				List<CachedSource> out = new ArrayList<CachedSource>();
				try (PreparedStatement select = connection.prepareStatement("SELECT source_facility_uuid, "
				        + "source_facility_name, bundle_json, content_hash, fetched_at FROM liberiaemr_remote_history "
				        + "WHERE patient_uuid = ? ORDER BY history_id")) {
					select.setString(1, patientUuid);
					try (ResultSet rs = select.executeQuery()) {
						while (rs.next()) {
							String source = rs.getString(1);
							out.add(new CachedSource(source == null || source.isEmpty() ? null : source, rs.getString(2),
							        rs.getString(3), rs.getString(4), new Date(rs.getTimestamp(5).getTime())));
						}
					}
				}
				return out;
			}
		});
	}

	/**
	 * @return when central last answered for the patient (outcome OK or EMPTY), or null when it never
	 *         has. This, not the bundle rows, is the age of the cache: an empty answer is still an
	 *         answer and leaves no bundle row behind.
	 */
	@Transactional(readOnly = true)
	public Date lastSuccessfulFetch(final String patientUuid) {
		return work(new ReturningWork<Date>() {

			@Override
			public Date execute(Connection connection) throws SQLException {
				try (PreparedStatement select = connection.prepareStatement("SELECT MAX(date_fetched) FROM "
				        + "liberiaemr_remote_history_fetch WHERE patient_uuid = ? AND outcome IN (?, ?)")) {
					select.setString(1, patientUuid);
					select.setString(2, OK);
					select.setString(3, EMPTY);
					try (ResultSet rs = select.executeQuery()) {
						Timestamp last = rs.next() ? rs.getTimestamp(1) : null;
						return last == null ? null : new Date(last.getTime());
					}
				}
			}
		});
	}

	/** Records one access: who, which patient, the reason given, the outcome and how much came back. */
	@Transactional
	public void logFetch(final Integer userId, final String patientUuid, final String reason, final String outcome,
	        final int resourceCount, final Date when) {
		work(new ReturningWork<Void>() {

			@Override
			public Void execute(Connection connection) throws SQLException {
				try (PreparedStatement insert = connection.prepareStatement("INSERT INTO liberiaemr_remote_history_fetch "
				        + "(user_id, patient_uuid, reason, outcome, resource_count, date_fetched) VALUES (?, ?, ?, ?, ?, ?)")) {
					if (userId == null) {
						insert.setNull(1, Types.INTEGER);
					} else {
						insert.setInt(1, userId);
					}
					insert.setString(2, patientUuid);
					insert.setString(3, reason.length() > 255 ? reason.substring(0, 255) : reason);
					insert.setString(4, outcome);
					insert.setInt(5, resourceCount);
					insert.setTimestamp(6, new Timestamp(when.getTime()));
					insert.executeUpdate();
				}
				return null;
			}
		});
	}

	private <T> T work(ReturningWork<T> work) {
		return sessionFactory.getCurrentSession().doReturningWork(work);
	}
}
