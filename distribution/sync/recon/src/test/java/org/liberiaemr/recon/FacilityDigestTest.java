package org.liberiaemr.recon;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import java.io.InputStream;
import java.util.Arrays;

import org.junit.Test;

public class FacilityDigestTest {

	@Test
	public void readsWhenTheSenderLastCapturedFromItsOffsetFile() throws Exception {
		try (InputStream in = getClass().getResourceAsStream("/offsets.txt")) {
			assertEquals(Long.valueOf(1790228551L), FacilityDigest.capturedAt(in.readAllBytes()));
		}
		assertNull(FacilityDigest.capturedAt(null));
		assertNull(FacilityDigest.capturedAt("no position here".getBytes()));
	}

	@Test
	public void leavesOutWhatTheSenderMayNotHaveCapturedYet() {
		long now = 1_000_000;
		assertEquals("the grace period", now - 3600, FacilityDigest.cutoff(now, 60, now));
		assertEquals("the grace period before the last captured event", now - 7200 - 3600,
		    FacilityDigest.cutoff(now, 60, now - 7200));
		assertEquals("no position yet: no digest", -1, FacilityDigest.cutoff(now, 60, null));
	}

	@Test
	public void takesNoDigestWhileTheFirstLoadRuns() {
		assertTrue(FacilityDigest.loading(
		    "x{\"ts_sec\":1,\"file\":\"binlog.000003\",\"pos\":154,\"snapshot\":true}x".getBytes()));
		assertFalse(FacilityDigest.loading(
		    "x{\"ts_sec\":1,\"file\":\"binlog.000003\",\"pos\":154,\"snapshot\":true,\"snapshot_completed\":true}x".getBytes()));
		assertFalse(FacilityDigest.loading("x{\"ts_sec\":1,\"file\":\"binlog.000003\",\"pos\":154}x".getBytes()));
	}

	@Test
	public void coversEveryOlderRecordInTwentyEightDigestsEvenIfNightsAreMissed() {
		boolean[] seen = new boolean[28];
		for (long sent = 5; sent < 5 + 28; sent++) {
			seen[FacilityDigest.sweepSlice(sent, 28)] = true;
		}
		boolean[] all = new boolean[28];
		Arrays.fill(all, true);
		assertEquals(Arrays.toString(all), Arrays.toString(seen));
	}

	@Test
	public void sendsOnceADayAndCatchesUpAfterAMissedNight() {
		long day = 1790294400L; // a midnight, UTC
		assertTrue("never sent", FacilityDigest.due(day + 10 * 3600, 0, 2));
		assertFalse("sent at 02:00, now 23:00", FacilityDigest.due(day + 23 * 3600, day + 2 * 3600, 2));
		assertTrue("sent at 02:00, now 02:00 the next day", FacilityDigest.due(day + 26 * 3600, day + 2 * 3600, 2));
		assertFalse("sent at 02:00, now 01:00 the next day", FacilityDigest.due(day + 25 * 3600, day + 2 * 3600, 2));
		assertTrue("a failed try at 02:00 is tried again at 03:00", FacilityDigest.due(day + 27 * 3600, day + 2 * 3600, 2));
		assertTrue("switched off overnight: any hour once a night is missed",
		    FacilityDigest.due(day + 50 * 3600, day + 2 * 3600, 2));
	}

	@Test
	public void readsTheEnrolmentDayOrMoment() {
		assertNull(Recon.since(""));
		assertEquals(Long.valueOf(1790294400L), Recon.since("2026-09-25"));
		assertEquals(Long.valueOf(1790294400L + 9 * 3600 + 30 * 60), Recon.since("2026-09-25T09:30"));
	}

	@Test
	public void comparesOnlyTablesWithTheirOwnUuid() {
		assertEquals("[person, obs, orders]",
		    Tables.watched("PERSON,PATIENT,OBS,ORDERS,DRUG_ORDER,TEST_ORDER,REFERRAL_ORDER,LOCATION").toString());
	}
}
