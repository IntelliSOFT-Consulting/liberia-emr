package org.liberiaemr.recon;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * What a facility says it holds: each record's table, uuid and creation day, nothing clinical.
 * Travels gzipped: a header line, then one tab-separated line per record.
 */
public final class Digest {

	static final String HEADER = "# liberiaemr-recon v1";

	private static final Pattern HEADER_LINE = Pattern
	        .compile("^# liberiaemr-recon v1 facility=([a-z0-9][a-z0-9-]{1,31}) taken=(\\d+) cutoff=(\\d+)$");

	private static final Pattern UUID = Pattern.compile("^[0-9a-f-]{36}$");

	private static final Pattern DAY = Pattern.compile("^(\\d{4}-\\d{2}-\\d{2}|unknown)$");

	/** Far above any facility's nightly digest; a larger one is refused before it is read. */
	static final int MAX_RECORDS = 1_000_000;

	public static final class Entry {

		public final String table;

		public final String uuid;

		public final String day;

		public Entry(String table, String uuid, String day) {
			this.table = table;
			this.uuid = uuid;
			this.day = day;
		}
	}

	public final String facility;

	/** Epoch seconds: when it was taken, and the moment before which every record is included. */
	public final long taken;

	public final long cutoff;

	public final List<Entry> entries;

	public Digest(String facility, long taken, long cutoff, List<Entry> entries) {
		this.facility = facility;
		this.taken = taken;
		this.cutoff = cutoff;
		this.entries = Collections.unmodifiableList(entries);
	}

	public byte[] toBytes() throws IOException {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (Writer out = new OutputStreamWriter(new GZIPOutputStream(bytes), StandardCharsets.UTF_8)) {
			out.write(HEADER + " facility=" + facility + " taken=" + taken + " cutoff=" + cutoff + "\n");
			for (Entry e : entries) {
				out.write(e.table + "\t" + e.uuid + "\t" + e.day + "\n");
			}
		}
		return bytes.toByteArray();
	}

	/**
	 * Reads a digest, checking every line before any of it reaches SQL: a known table, a uuid of
	 * hex digits and hyphens, and a day.
	 *
	 * @throws IllegalArgumentException for anything else
	 */
	public static Digest fromBytes(byte[] data) throws IOException {
		try (BufferedReader in = new BufferedReader(
		        new InputStreamReader(new GZIPInputStream(new ByteArrayInputStream(data)), StandardCharsets.UTF_8))) {
			String header = in.readLine();
			Matcher m = header == null ? null : HEADER_LINE.matcher(header);
			if (m == null || !m.matches()) {
				throw new IllegalArgumentException("not a reconciliation digest");
			}
			List<Entry> entries = new ArrayList<>();
			String line;
			int n = 1;
			while ((line = in.readLine()) != null) {
				n++;
				String[] f = line.split("\t", -1);
				if (f.length != 3 || !Tables.COMPARED.contains(f[0]) || !UUID.matcher(f[1]).matches()
				        || !DAY.matcher(f[2]).matches()) {
					throw new IllegalArgumentException("line " + n + " is not a table, uuid and day");
				}
				if (entries.size() == MAX_RECORDS) {
					throw new IllegalArgumentException("more than " + MAX_RECORDS + " records");
				}
				entries.add(new Entry(f[0], f[1], f[2]));
			}
			return new Digest(m.group(1), Long.parseLong(m.group(2)), Long.parseLong(m.group(3)), entries);
		}
	}
}
