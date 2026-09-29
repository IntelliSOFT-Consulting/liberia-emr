package org.liberiaemr.recon;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Compares facility digests with central's replica and keeps the gaps in the receiver's
 * management schema, where the EMR reads them. A gap is first a suspicion; it is confirmed only
 * when the record is still absent after the confirm window, nothing for it is waiting at the
 * receiver, and the broker holds no backlog that could still deliver it.
 */
public final class CentralCheck {

	/** dbsync's own daemon user: every install has it and central skips it by design. */
	static final String DAEMON_USER = "a4f30a1b-5eb9-11df-a648-37a07f9c90fb";

	static final int BATCH = 500;

	/** How many open gaps one pass re-checks; the rest wait for the next pass. */
	static final int RECHECK_LIMIT = 20_000;

	/**
	 * A facility's digests list every record it holds within 28 digests (FacilityDigest's sweep);
	 * with a week's margin for missed nights, a gap no digest has listed for longer is a record the
	 * facility no longer holds.
	 */
	static final long UNLISTED_AFTER_SECONDS = 42 * 86_400L;

	private CentralCheck() {
	}

	/** @return the uuids central skips by design, from db-sync.excludedEntities (entity:uuid,...) */
	public static Set<String> skipped(String excludedEntities) {
		Set<String> out = new HashSet<>();
		out.add(DAEMON_USER);
		if (excludedEntities != null) {
			for (String e : excludedEntities.split(",")) {
				int colon = e.indexOf(':');
				if (colon > 0) {
					out.add(e.substring(colon + 1).trim().toLowerCase(Locale.ROOT));
				}
			}
		}
		return out;
	}

	/** The digest's records central does not hold, skips by design, or still has queued. */
	public static List<Digest.Entry> missing(Digest digest, Map<String, Set<String>> foundByTable, Set<String> skipped,
	        Set<String> inflight) {
		List<Digest.Entry> out = new ArrayList<>();
		for (Digest.Entry e : digest.entries) {
			Set<String> found = foundByTable.get(e.table);
			if ((found == null || !found.contains(e.uuid)) && !skipped.contains(e.uuid) && !inflight.contains(e.uuid)) {
				out.add(e);
			}
		}
		return out;
	}

	public static boolean shouldConfirm(long firstSeen, long now, int confirmHours, boolean backlogEmpty) {
		return backlogEmpty && now - firstSeen >= confirmHours * 3600L;
	}

	public static void createTables(Connection mgmt) throws SQLException {
		try (Statement s = mgmt.createStatement()) {
			s.execute("CREATE TABLE IF NOT EXISTS liberiaemr_recon_digest (facility VARCHAR(32) NOT NULL PRIMARY KEY,"
			        + " taken BIGINT NOT NULL, cutoff BIGINT NOT NULL, records INT NOT NULL, received BIGINT NOT NULL)");
			s.execute("CREATE TABLE IF NOT EXISTS liberiaemr_recon_missing (facility VARCHAR(32) NOT NULL,"
			        + " table_name VARCHAR(64) NOT NULL, uuid CHAR(36) NOT NULL, day_created VARCHAR(10) NOT NULL,"
			        + " first_seen BIGINT NOT NULL, last_listed BIGINT NOT NULL, last_checked BIGINT NOT NULL,"
			        + " confirmed TINYINT(1) NOT NULL DEFAULT 0, PRIMARY KEY (facility, table_name, uuid))");
		}
	}

	/** Records a digest and every record in it central does not hold as a suspected gap. */
	public static int record(Connection openmrs, Connection mgmt, Digest digest, Set<String> skipped, long now)
	        throws SQLException {
		Map<String, List<String>> byTable = new LinkedHashMap<>();
		for (Digest.Entry e : digest.entries) {
			byTable.computeIfAbsent(e.table, t -> new ArrayList<>()).add(e.uuid);
		}
		Map<String, Set<String>> found = new HashMap<>();
		for (Map.Entry<String, List<String>> t : byTable.entrySet()) {
			found.put(t.getKey(), present(openmrs, t.getKey(), t.getValue()));
		}
		List<String> absent = new ArrayList<>();
		for (Digest.Entry e : digest.entries) {
			Set<String> f = found.get(e.table);
			if (f == null || !f.contains(e.uuid)) {
				absent.add(e.uuid);
			}
		}
		List<Digest.Entry> gaps = missing(digest, found, skipped, inflight(mgmt, absent));

		try (PreparedStatement ps = mgmt.prepareStatement("INSERT INTO liberiaemr_recon_digest"
		        + " (facility, taken, cutoff, records, received) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE"
		        + " taken = VALUES(taken), cutoff = VALUES(cutoff), records = VALUES(records), received = VALUES(received)")) {
			ps.setString(1, digest.facility);
			ps.setLong(2, digest.taken);
			ps.setLong(3, digest.cutoff);
			ps.setInt(4, digest.entries.size());
			ps.setLong(5, now);
			ps.executeUpdate();
		}
		try (PreparedStatement ps = mgmt.prepareStatement("INSERT INTO liberiaemr_recon_missing"
		        + " (facility, table_name, uuid, day_created, first_seen, last_listed, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?)"
		        + " ON DUPLICATE KEY UPDATE last_listed = VALUES(last_listed)")) {
			for (Digest.Entry e : gaps) {
				ps.setString(1, digest.facility);
				ps.setString(2, e.table);
				ps.setString(3, e.uuid);
				ps.setString(4, e.day);
				ps.setLong(5, now);
				ps.setLong(6, now);
				ps.setLong(7, now);
				ps.addBatch();
			}
			ps.executeBatch();
		}
		return gaps.size();
	}

	/**
	 * Looks at open gaps again: a record that has arrived closes its gap, one still queued at the
	 * receiver stays a suspicion, and one absent past the confirm window is confirmed.
	 */
	public static void recheck(Connection openmrs, Connection mgmt, long now, int confirmHours, boolean backlogEmpty)
	        throws SQLException {
		// Measured from the facility's latest digest, not the clock: a facility that has stopped
		// sending digests keeps its gaps.
		try (PreparedStatement ps = mgmt.prepareStatement("DELETE m FROM liberiaemr_recon_missing m"
		        + " JOIN liberiaemr_recon_digest d ON d.facility = m.facility WHERE m.last_listed < d.received - ?")) {
			ps.setLong(1, UNLISTED_AFTER_SECONDS);
			ps.executeUpdate();
		}
		Map<String, List<Gap>> byTable = new TreeMap<>();
		try (PreparedStatement ps = mgmt.prepareStatement("SELECT facility, table_name, uuid, first_seen, confirmed"
		        + " FROM liberiaemr_recon_missing ORDER BY last_checked LIMIT " + RECHECK_LIMIT)) {
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) {
					byTable.computeIfAbsent(rs.getString(2), t -> new ArrayList<>())
					        .add(new Gap(rs.getString(1), rs.getString(3), rs.getLong(4), rs.getInt(5) == 1));
				}
			}
		}
		for (Map.Entry<String, List<Gap>> t : byTable.entrySet()) {
			if (!Tables.COMPARED.contains(t.getKey())) {
				continue;
			}
			List<String> uuids = new ArrayList<>();
			for (Gap gap : t.getValue()) {
				uuids.add(gap.uuid);
			}
			Set<String> arrived = present(openmrs, t.getKey(), uuids);
			Set<String> queued = inflight(mgmt, uuids);
			try (PreparedStatement close = mgmt.prepareStatement(
			    "DELETE FROM liberiaemr_recon_missing WHERE facility = ? AND table_name = ? AND uuid = ?");
			        PreparedStatement touch = mgmt.prepareStatement("UPDATE liberiaemr_recon_missing SET last_checked = ?,"
			                + " confirmed = ? WHERE facility = ? AND table_name = ? AND uuid = ?")) {
				for (Gap gap : t.getValue()) {
					if (arrived.contains(gap.uuid)) {
						close.setString(1, gap.facility);
						close.setString(2, t.getKey());
						close.setString(3, gap.uuid);
						close.addBatch();
						continue;
					}
					boolean confirmed = gap.confirmed
					        || !queued.contains(gap.uuid) && shouldConfirm(gap.firstSeen, now, confirmHours, backlogEmpty);
					touch.setLong(1, now);
					touch.setInt(2, confirmed ? 1 : 0);
					touch.setString(3, gap.facility);
					touch.setString(4, t.getKey());
					touch.setString(5, gap.uuid);
					touch.addBatch();
				}
				close.executeBatch();
				touch.executeBatch();
			}
		}
	}

	/** An open gap as recheck reads it. */
	private static final class Gap {

		final String facility;

		final String uuid;

		final long firstSeen;

		final boolean confirmed;

		Gap(String facility, String uuid, long firstSeen, boolean confirmed) {
			this.facility = facility;
			this.uuid = uuid;
			this.firstSeen = firstSeen;
			this.confirmed = confirmed;
		}
	}

	/** Prometheus text for the last state, one series per facility. */
	public static String metrics(Connection mgmt, long now) throws SQLException {
		StringBuilder out = new StringBuilder();
		Map<String, long[]> facilities = new TreeMap<>();
		try (Statement s = mgmt.createStatement();
		        ResultSet rs = s.executeQuery("SELECT facility, taken, records FROM liberiaemr_recon_digest")) {
			while (rs.next()) {
				facilities.put(rs.getString(1), new long[] { rs.getLong(2), rs.getLong(3), 0, 0 });
			}
		}
		try (Statement s = mgmt.createStatement(); ResultSet rs = s.executeQuery(
		    "SELECT facility, SUM(confirmed = 1), SUM(confirmed = 0) FROM liberiaemr_recon_missing GROUP BY facility")) {
			while (rs.next()) {
				long[] f = facilities.computeIfAbsent(rs.getString(1), k -> new long[4]);
				f[2] = rs.getLong(2);
				f[3] = rs.getLong(3);
			}
		}
		out.append("# TYPE sync_recon_missing_records gauge\n");
		facilities.forEach((k, f) -> out.append("sync_recon_missing_records{facility=\"").append(k).append("\"} ")
		        .append(f[2]).append('\n'));
		out.append("# TYPE sync_recon_suspected_records gauge\n");
		facilities.forEach((k, f) -> out.append("sync_recon_suspected_records{facility=\"").append(k).append("\"} ")
		        .append(f[3]).append('\n'));
		out.append("# TYPE sync_recon_digest_records gauge\n");
		facilities.forEach((k, f) -> out.append("sync_recon_digest_records{facility=\"").append(k).append("\"} ")
		        .append(f[1]).append('\n'));
		out.append("# TYPE sync_recon_digest_taken_seconds gauge\n");
		facilities.forEach((k, f) -> {
			if (f[0] > 0) {
				out.append("sync_recon_digest_taken_seconds{facility=\"").append(k).append("\"} ").append(f[0]).append('\n');
			}
		});
		out.append("# TYPE sync_recon_last_run_seconds gauge\n").append("sync_recon_last_run_seconds ").append(now)
		        .append('\n');
		return out.toString();
	}

	/** The uuids among these that exist in the table, looked up in batches. */
	static Set<String> present(Connection openmrs, String table, Collection<String> uuids) throws SQLException {
		if (!Tables.COMPARED.contains(table)) {
			throw new IllegalArgumentException("not a compared table: " + table);
		}
		return lookup(openmrs, uuids, n -> "SELECT LOWER(uuid) FROM `" + table + "` WHERE uuid IN (" + n + ")");
	}

	/** The uuids among these that the receiver still holds, to apply, retry or have decided. */
	static Set<String> inflight(Connection mgmt, Collection<String> uuids) throws SQLException {
		return lookup(mgmt, uuids,
		    n -> "SELECT LOWER(identifier) FROM receiver_sync_msg WHERE identifier IN (" + n + ")"
		            + " UNION SELECT LOWER(identifier) FROM receiver_retry_queue WHERE identifier IN (" + n + ")"
		            + " UNION SELECT LOWER(identifier) FROM receiver_conflict_queue WHERE identifier IN (" + n + ")");
	}

	private interface Query {

		String sql(String placeholders);
	}

	private static Set<String> lookup(Connection c, Collection<String> uuids, Query query) throws SQLException {
		Set<String> out = new HashSet<>();
		List<String> all = new ArrayList<>(uuids);
		for (int i = 0; i < all.size(); i += BATCH) {
			List<String> batch = all.subList(i, Math.min(i + BATCH, all.size()));
			String sql = query.sql(String.join(",", java.util.Collections.nCopies(batch.size(), "?")));
			int repeats = sql.split("IN \\(", -1).length - 1;
			try (PreparedStatement ps = c.prepareStatement(sql)) {
				int p = 1;
				for (int r = 0; r < repeats; r++) {
					for (String u : batch) {
						ps.setString(p++, u);
					}
				}
				try (ResultSet rs = ps.executeQuery()) {
					while (rs.next()) {
						out.add(rs.getString(1));
					}
				}
			}
		}
		return out;
	}
}
