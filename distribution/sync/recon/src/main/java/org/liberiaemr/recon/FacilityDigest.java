package org.liberiaemr.recon;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds the facility's digest: every record created before the cutoff in the recent window, and
 * one slice of the older ones, so a month of nights covers the whole database.
 */
public final class FacilityDigest {

	private static final Pattern OFFSET = Pattern.compile("\\{[^{}]*\"pos\":\\d+[^{}]*\\}");

	private static final Pattern TS_SEC = Pattern.compile("\"ts_sec\":(\\d+)");

	private static final Pattern SNAPSHOT = Pattern.compile("\"snapshot\":\"?true");

	private static final Pattern UUID = Pattern.compile("^[0-9a-f-]{36}$");

	private FacilityDigest() {
	}

	/**
	 * @return the time of the last binlog event the sender saved, from its Debezium offset file
	 *         (a serialised Java map, read as text); null when there is none
	 */
	public static Long capturedAt(byte[] offsetFile) {
		String last = lastOffset(offsetFile);
		if (last == null) {
			return null;
		}
		Matcher ts = TS_SEC.matcher(last);
		return ts.find() ? Long.valueOf(ts.group(1)) : null;
	}

	private static String lastOffset(byte[] offsetFile) {
		if (offsetFile == null) {
			return null;
		}
		String last = null;
		Matcher m = OFFSET.matcher(new String(offsetFile, StandardCharsets.ISO_8859_1));
		while (m.find()) {
			last = m.group();
		}
		return last;
	}

	/** True while the sender's first load is still reading every table. */
	public static boolean loading(byte[] offsetFile) {
		String last = lastOffset(offsetFile);
		return last != null && SNAPSHOT.matcher(last).find() && !last.contains("\"snapshot_completed\":true");
	}

	/**
	 * Only records the sender has certainly captured belong in the digest: older than the grace
	 * period and than the last event it saved. Records it captured but still holds are left out
	 * by uuid (queued).
	 *
	 * @return epoch seconds, or -1 when the sender has no saved position yet
	 */
	public static long cutoff(long now, int graceMinutes, Long capturedAt) {
		return capturedAt == null ? -1 : Math.min(now, capturedAt) - graceMinutes * 60L;
	}

	/** Which slice of the older records a digest carries: the next one after the last sent. */
	public static int sweepSlice(long digestsSent, int sweepDays) {
		return (int) Math.floorMod(digestsSent, sweepDays);
	}

	/**
	 * Whether a digest is due: in the chosen hour (UTC) or the three after it, once a day, and at
	 * any hour once a night has been missed, so a server switched off overnight still sends one.
	 */
	public static boolean due(long now, long lastSent, int hour) {
		long elapsed = now - lastSent;
		if (lastSent <= 0 || elapsed >= 26 * 3600L) {
			return true;
		}
		long pastHour = Math.floorMod(Math.floorMod(now, 86_400L) / 3600 - hour, 24);
		return elapsed >= 20 * 3600L && pastHour < 4;
	}

	/**
	 * The uuids of records the sender has captured but not yet sent: they are not at central
	 * and must not look lost. Null when there are more than the limit, as during a backlog,
	 * when no digest is taken.
	 */
	public static Set<String> queued(Connection mgmt, int limit) throws SQLException {
		Set<String> out = new HashSet<>();
		try (Statement s = mgmt.createStatement(); ResultSet rs = s.executeQuery(
		    "SELECT LOWER(identifier) FROM debezium_event_queue UNION SELECT LOWER(identifier) FROM sender_retry_queue"
		            + " LIMIT " + (limit + 1))) {
			while (rs.next()) {
				if (rs.getString(1) != null) {
					out.add(rs.getString(1));
				}
				if (out.size() > limit) {
					return null;
				}
			}
		}
		return out;
	}

	/**
	 * Reads every table in one consistent snapshot, so the digest describes one moment.
	 *
	 * @param slice which slice of the older records to carry
	 * @param queued uuids the sender still holds, left out
	 * @param since epoch seconds before which records are left out, or null for all
	 */
	public static Digest build(Connection openmrs, Set<String> tables, String facility, long now, long cutoff,
	        int recentDays, int sweepDays, int slice, Set<String> queued, Long since) throws SQLException {
		List<Digest.Entry> entries = new ArrayList<>();
		long recentFrom = now - recentDays * 86_400L;
		int unusable = 0;
		boolean autoCommit = openmrs.getAutoCommit();
		openmrs.setAutoCommit(false);
		try (Statement begin = openmrs.createStatement()) {
			begin.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
			for (String table : tables) {
				if (!Tables.COMPARED.contains(table)) {
					throw new IllegalArgumentException("not a compared table: " + table);
				}
				String sql = "SELECT LOWER(uuid), COALESCE(DATE_FORMAT(date_created, '%Y-%m-%d'), 'unknown') FROM `" + table
				        + "` WHERE (date_created IS NULL OR date_created < FROM_UNIXTIME(?))"
				        + " AND (date_created IS NULL OR date_created >= FROM_UNIXTIME(?) OR MOD(CONV(LEFT(uuid, 4), 16, 10), ?) = ?)"
				        + " AND (date_created IS NULL OR date_created >= FROM_UNIXTIME(?))";
				try (PreparedStatement ps = openmrs.prepareStatement(sql)) {
					ps.setLong(1, cutoff);
					ps.setLong(2, recentFrom);
					ps.setInt(3, sweepDays);
					ps.setInt(4, slice);
					ps.setLong(5, since == null ? 0 : since);
					ps.setFetchSize(Integer.MIN_VALUE);
					try (ResultSet rs = ps.executeQuery()) {
						while (rs.next()) {
							String uuid = rs.getString(1);
							// A uuid central could never have been sent as one is left out rather than
							// spoiling the whole digest.
							if (uuid == null || !UUID.matcher(uuid).matches()) {
								unusable++;
							} else if (!queued.contains(uuid)) {
								if (entries.size() == Digest.MAX_RECORDS) {
									throw new IllegalStateException("more than " + Digest.MAX_RECORDS + " records");
								}
								entries.add(new Digest.Entry(table, uuid, rs.getString(2)));
							}
						}
					}
				}
			}
			openmrs.commit();
		}
		finally {
			openmrs.setAutoCommit(autoCommit);
		}
		if (unusable > 0) {
			System.out.println("[recon] left out " + unusable + " records whose uuid is not a uuid");
		}
		return new Digest(facility, now, cutoff, entries);
	}
}
