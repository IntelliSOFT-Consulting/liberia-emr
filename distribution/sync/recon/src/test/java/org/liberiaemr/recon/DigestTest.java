package org.liberiaemr.recon;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.GZIPOutputStream;

import org.junit.Test;

public class DigestTest {

	private static final String UUID = "0c2460f6-c1c3-4524-a589-be5faf79c6f3";

	@Test
	public void survivesTheTripToCentral() throws Exception {
		Digest sent = new Digest("careysburg", 1790300000L, 1790296400L,
		        Arrays.asList(new Digest.Entry("person", UUID, "2026-09-25"), new Digest.Entry("obs", UUID, "unknown")));
		Digest read = Digest.fromBytes(sent.toBytes());
		assertEquals("careysburg", read.facility);
		assertEquals(1790300000L, read.taken);
		assertEquals(1790296400L, read.cutoff);
		assertEquals(2, read.entries.size());
		assertEquals("obs", read.entries.get(1).table);
		assertEquals("unknown", read.entries.get(1).day);
	}

	@Test
	public void refusesAnythingThatIsNotADigest() throws Exception {
		refused("hello\n");
		refused(Digest.HEADER + " facility=../etc taken=1 cutoff=1\n");
	}

	@Test
	public void refusesALineThatCouldReachSqlAsAnythingButData() throws Exception {
		String header = Digest.HEADER + " facility=careysburg taken=1 cutoff=1\n";
		refused(header + "person; DROP TABLE person\t" + UUID + "\t2026-09-25\n");
		refused(header + "patient\t" + UUID + "\t2026-09-25\n");
		refused(header + "person\t' OR 1=1 --\t2026-09-25\n");
		refused(header + "person\t" + UUID + "\tyesterday\n");
		refused(header + "person\t" + UUID + "\n");
	}

	private static void refused(String text) throws Exception {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
			gz.write(text.getBytes(StandardCharsets.UTF_8));
		}
		try {
			Digest.fromBytes(bytes.toByteArray());
			fail("accepted: " + text);
		}
		catch (IllegalArgumentException expected) {
			// refused, as it should be
		}
	}
}
