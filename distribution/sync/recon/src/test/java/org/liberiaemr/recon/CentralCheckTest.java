package org.liberiaemr.recon;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class CentralCheckTest {

	private static final String HERE = "11111111-1111-1111-1111-111111111111";

	private static final String GONE = "22222222-2222-2222-2222-222222222222";

	private static final String QUEUED = "33333333-3333-3333-3333-333333333333";

	private static final String ADMIN = "82f18b44-6814-11e8-923f-e9a88dcb533f";

	@Test
	public void aRecordCentralDoesNotHoldIsAGap() {
		Digest digest = new Digest("careysburg", 1, 1,
		        Arrays.asList(entry(HERE), entry(GONE), entry(QUEUED), entry(ADMIN), entry(CentralCheck.DAEMON_USER)));
		Map<String, Set<String>> found = new HashMap<>();
		found.put("person", new HashSet<>(Collections.singletonList(HERE)));
		Set<String> skipped = CentralCheck.skipped("users:" + ADMIN + ",person:5f87c042-6814-11e8-923f-e9a88dcb533f");
		List<Digest.Entry> gaps = CentralCheck.missing(digest, found, skipped,
		    new HashSet<>(Collections.singletonList(QUEUED)));
		assertEquals(1, gaps.size());
		assertEquals(GONE, gaps.get(0).uuid);
	}

	@Test
	public void aGapIsConfirmedOnlyOnceNothingCanStillDeliverIt() {
		long firstSeen = 1_000_000;
		assertFalse("inside the confirm window", CentralCheck.shouldConfirm(firstSeen, firstSeen + 3600, 6, true));
		assertFalse("the broker still holds a backlog", CentralCheck.shouldConfirm(firstSeen, firstSeen + 7 * 3600, 6, false));
		assertTrue(CentralCheck.shouldConfirm(firstSeen, firstSeen + 6 * 3600, 6, true));
	}

	private static Digest.Entry entry(String uuid) {
		return new Digest.Entry("person", uuid, "2026-09-25");
	}
}
