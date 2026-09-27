/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Location;
import org.openmrs.LocationAttribute;
import org.openmrs.LocationAttributeType;
import org.openmrs.api.LocationService;
import org.openmrs.api.context.Context;
import org.openmrs.test.BaseModuleContextSensitiveTest;

public class MflSyncEngineTest extends BaseModuleContextSensitiveTest {

	private static final String JAH = "nY6mPgT0Kc6";

	private static final String KPAAI = "TSrmxt9mnrS";

	private static final String BONG = "EriWrruEGwa";

	private static final String FUAMAH = "eDCCmFPNWZo";

	private static final String BARNERSVILLE = "kueVlXwUXiI";

	private static final String SOMALIA_DRIVE = "E57DkQD0HC4";

	private static final int FIXTURE_LOCATIONS = 23;

	private LocationService locations;

	private final Date runDate = date("2026-09-28");

	@Before
	public void metadata() {
		locations = Context.getLocationService();
		MflTestMetadata.create(locations);
	}

	private MflSyncEngine.Result run(List<MflUnit> units, boolean dryRun) throws MflException {
		return run(new MflSnapshot(units, Collections.<String> emptyList()), dryRun);
	}

	private MflSyncEngine.Result run(MflSnapshot snapshot, boolean dryRun) throws MflException {
		MflSyncEngine.Result result = new MflSyncEngine(locations).run(snapshot, dryRun, runDate);
		Context.flushSession();
		return result;
	}

	private MflSyncEngine.Result run() throws MflException {
		return run(MflFixture.units(), false);
	}

	private Location mfl(String uid) {
		return locations.getLocationByUuid(MflUuid.forUid(uid));
	}

	private String attribute(Location location, String typeUuid) {
		LocationAttributeType type = locations.getLocationAttributeTypeByUuid(typeUuid);
		List<LocationAttribute> active = location.getActiveAttributes(type);
		return active.isEmpty() ? null : active.get(0).getValueReference();
	}

	private static MflRunItem item(MflSyncEngine.Result result, String uid) {
		for (MflRunItem item : result.getItems()) {
			if (uid.equals(item.getMflUid())) {
				return item;
			}
		}
		return null;
	}

	private static List<MflUnit> replace(List<MflUnit> units, MflUnit changed) {
		List<MflUnit> out = new ArrayList<MflUnit>();
		for (MflUnit unit : units) {
			out.add(unit.getUid().equals(changed.getUid()) ? changed : unit);
		}
		return out;
	}

	private static List<MflUnit> without(List<MflUnit> units, String uid) {
		List<MflUnit> out = new ArrayList<MflUnit>();
		for (MflUnit unit : units) {
			if (!unit.getUid().equals(uid)) {
				out.add(unit);
			}
		}
		return out;
	}

	private static MflUnit with(MflUnit u, String name, String parentUid, String closedDate) {
		return new MflUnit(u.getUid(), u.getCode(), name, u.getLevel(), parentUid, closedDate, u.getLastUpdated(),
		        u.getLatitude(), u.getLongitude(), u.getGroups());
	}

	private static Date date(String ymd) {
		try {
			return new SimpleDateFormat("yyyy-MM-dd").parse(ymd);
		}
		catch (java.text.ParseException e) {
			throw new IllegalStateException(e);
		}
	}

	/** A location as a site package seeds it: its own UUID, and an MFL UID once confirmed. */
	private Location siteRoot(String name, String mflUid) {
		Location root = new Location();
		root.setName(name);
		root.setDescription("seeded by the site package");
		root.addTag(locations.getLocationTagByName(MflConstants.TAG_LOGIN_LOCATION));
		if (mflUid != null) {
			LocationAttribute uid = new LocationAttribute();
			uid.setAttributeType(locations.getLocationAttributeTypeByUuid(MflConstants.ATTR_MFL_UID));
			uid.setValue(mflUid);
			root.addAttribute(uid);
		}
		return locations.saveLocation(root);
	}

	@Test
	public void run_shouldCreateEveryCountyDistrictAndFacilityOnAFirstRun() throws Exception {
		MflSyncEngine.Result result = run();

		assertEquals(FIXTURE_LOCATIONS, result.getCounts().getCreated());
		assertEquals(0, result.getCounts().getFailed());
		Location jah = mfl(JAH);
		assertNotNull("a created row gets the v5 UUID of its MFL UID", jah);
		assertEquals("Jah Clinic", jah.getName());
		assertEquals(mfl(KPAAI), jah.getParentLocation());
		assertEquals(mfl(BONG), mfl(KPAAI).getParentLocation());
		assertNull("counties are top-level", mfl(BONG).getParentLocation());
		assertTrue(jah.hasTag(MflConstants.TAG_HEALTH_FACILITY));
		assertTrue(mfl(KPAAI).hasTag(MflConstants.TAG_DISTRICT));
		assertTrue(mfl(BONG).hasTag(MflConstants.TAG_COUNTY));
		assertEquals("6.814444", jah.getLatitude());
		assertEquals("-9.186944", jah.getLongitude());
		assertEquals("Bong", jah.getStateProvince());
		assertEquals("Kpaai", jah.getCountyDistrict());
		assertEquals("Liberia", jah.getCountry());
		assertEquals(JAH, attribute(jah, MflConstants.ATTR_MFL_UID));
		assertEquals("LBR-06-0624-06", attribute(jah, MflConstants.ATTR_MFL_CODE));
		assertEquals("Clinic", attribute(jah, MflConstants.ATTR_FACILITY_TYPE));
		assertEquals("Private", attribute(jah, MflConstants.ATTR_FACILITY_OWNERSHIP));
		assertEquals("Rural", attribute(jah, MflConstants.ATTR_FACILITY_SETTING));
		assertEquals("2026-06-20T21:48:12.934", attribute(jah, MflConstants.ATTR_MFL_LAST_UPDATED));
		assertFalse(jah.hasTag(MflConstants.TAG_LOGIN_LOCATION));
		assertEquals(MflAction.CREATE, item(result, JAH).getAction());
		assertEquals(jah.getUuid(), item(result, JAH).getLocationUuid());
	}

	@Test
	public void run_shouldCreateAClosedFacilityRetired() throws Exception {
		run();
		Location closed = mfl("ucTzZhF5okn");
		assertTrue(closed.getRetired());
		assertEquals("MFL: closed 2026-04-01", closed.getRetireReason());
		assertEquals("2026-04-01", attribute(closed, MflConstants.ATTR_MFL_CLOSED_DATE));
		assertEquals("Jamaica Rd Clinic (Bushrod District)", closed.getName());
		assertFalse(mfl("ZktsAIReh6z").getRetired());
	}

	@Test
	public void run_shouldChangeNothingOnASecondRun() throws Exception {
		run();
		MflSyncEngine.Result second = run();
		assertEquals(0, second.getCounts().getCreated());
		assertEquals(0, second.getCounts().getUpdated());
		assertEquals(0, second.getCounts().getRetired());
		assertEquals(0, second.getCounts().getUnretired());
		assertEquals(FIXTURE_LOCATIONS, second.getCounts().getUnchanged());
		for (MflRunItem item : second.getItems()) {
			assertEquals("only warnings are recorded for unchanged locations", MflAction.WARNING, item.getAction());
		}
	}

	@Test
	public void run_shouldRecordWarningsAndCountTheItemsThatHaveThem() throws Exception {
		MflSyncEngine.Result result = run();
		MflRunItem kesselee = item(result, "VxgfT09KRV4");
		assertThat(kesselee.getWarnings(), hasItem("Facility Type: in Clinic and Health Center; Health Center wins"));
		assertTrue(result.getCounts().getWarnings() >= 5);
	}

	@Test
	public void run_shouldRenameALocation() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		MflSyncEngine.Result result = run(replace(MflFixture.units(), with(jah, "Jah Community Clinic", KPAAI, null)),
		    false);
		assertEquals("Jah Community Clinic", mfl(JAH).getName());
		MflRunItem item = item(result, JAH);
		assertEquals(MflAction.UPDATE, item.getAction());
		assertEquals("name", item.getChanges().get(0).getField());
		assertEquals("Jah Clinic", item.getChanges().get(0).getFrom());
		assertEquals("Jah Community Clinic", item.getChanges().get(0).getTo());
		assertEquals(1, result.getCounts().getUpdated());
	}

	@Test
	public void run_shouldReparentALocationAndItsAddress() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		MflSyncEngine.Result result = run(replace(MflFixture.units(), with(jah, jah.getName(), FUAMAH, null)), false);
		assertEquals(mfl(FUAMAH), mfl(JAH).getParentLocation());
		assertEquals("Fuamah", mfl(JAH).getCountyDistrict());
		MflRunItem item = item(result, JAH);
		assertEquals(MflAction.UPDATE, item.getAction());
		assertEquals("parent", item.getChanges().get(0).getField());
		assertEquals("Kpaai", item.getChanges().get(0).getFrom());
		assertEquals("Fuamah", item.getChanges().get(0).getTo());
	}

	@Test
	public void run_shouldVoidAnAttributeTheFacilityNoLongerHas() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		List<String> groups = new ArrayList<String>(jah.getGroups());
		groups.remove(MflConstants.GROUP_CLINIC);
		MflUnit declassified = new MflUnit(JAH, jah.getCode(), jah.getName(), 4, KPAAI, null, jah.getLastUpdated(),
		        jah.getLatitude(), jah.getLongitude(), new java.util.LinkedHashSet<String>(groups));
		MflSyncEngine.Result result = run(replace(MflFixture.units(), declassified), false);
		assertNull(attribute(mfl(JAH), MflConstants.ATTR_FACILITY_TYPE));
		assertEquals("attribute:Facility Type", item(result, JAH).getChanges().get(0).getField());
		assertEquals("Clinic", item(result, JAH).getChanges().get(0).getFrom());
		assertNull(item(result, JAH).getChanges().get(0).getTo());
	}

	@Test
	public void run_shouldRetireAFacilityTheMflCloses() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		MflSyncEngine.Result result = run(replace(MflFixture.units(), with(jah, jah.getName(), KPAAI, "2026-09-01")),
		    false);
		assertTrue(mfl(JAH).getRetired());
		assertEquals("MFL: closed 2026-09-01", mfl(JAH).getRetireReason());
		assertEquals(MflAction.RETIRE, item(result, JAH).getAction());
		assertEquals(1, result.getCounts().getRetired());
	}

	@Test
	public void run_shouldRetireALocationThatLeavesTheMfl() throws Exception {
		run();
		MflSyncEngine.Result result = run(without(MflFixture.units(), JAH), false);
		assertTrue(mfl(JAH).getRetired());
		assertEquals("MFL: not in the MFL since 2026-09-28", mfl(JAH).getRetireReason());
		assertEquals(MflAction.RETIRE, item(result, JAH).getAction());
		assertTrue("a district left without facilities goes too", mfl(KPAAI).getRetired());
		assertNull(result.getMessage());
	}

	@Test
	public void run_shouldUnretireALocationTheSyncRetiredWhenItReturns() throws Exception {
		run();
		run(without(MflFixture.units(), JAH), false);
		MflSyncEngine.Result result = run();
		assertFalse(mfl(JAH).getRetired());
		assertEquals(MflAction.UNRETIRE, item(result, JAH).getAction());
		// Jah Clinic is Kpaai's only facility, so the district left and came back with it.
		assertFalse(mfl(KPAAI).getRetired());
		assertEquals(2, result.getCounts().getUnretired());
	}

	@Test
	public void run_shouldNeverReverseARetirementMadeByHand() throws Exception {
		run();
		locations.retireLocation(mfl(JAH), "Merged into the district hospital");
		Context.flushSession();
		MflSyncEngine.Result result = run();
		assertTrue(mfl(JAH).getRetired());
		assertEquals("Merged into the district hospital", mfl(JAH).getRetireReason());
		assertEquals(MflAction.WARNING, item(result, JAH).getAction());
		assertThat(item(result, JAH).getWarnings().get(0), containsString("left retired"));
	}

	@Test
	public void run_shouldNotRetireOnAbsenceWhenAPageFailed() throws Exception {
		run();
		MflSyncEngine.Result result = run(new MflSnapshot(without(MflFixture.units(), JAH),
		        Collections.singletonList("facilities page 2: HTTP 500")), false);
		assertFalse(mfl(JAH).getRetired());
		assertNull(item(result, JAH));
		assertThat(result.getMessage(), containsString("facilities page 2: HTTP 500"));
		assertTrue(result.isRetirementSkipped());
	}

	@Test
	public void run_shouldNotRetireOnAbsenceWhenThePullHoldsUnder90PercentOfWhatIsHeld() throws Exception {
		run();
		List<MflUnit> shrunk = MflFixture.units();
		for (String uid : new String[] { JAH, "VxgfT09KRV4", "PJbJHw1srOd" }) {
			shrunk = without(shrunk, uid);
		}
		MflSyncEngine.Result result = run(shrunk, false);
		assertFalse(mfl(JAH).getRetired());
		assertTrue(result.isRetirementSkipped());
		assertThat(result.getMessage(), containsString("under 90%"));
	}

	@Test
	public void run_shouldStillApplyAClosureWhenRetirementOnAbsenceIsSkipped() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		run(new MflSnapshot(replace(MflFixture.units(), with(jah, jah.getName(), KPAAI, "2026-09-01")),
		        Collections.singletonList("facilities page 2: HTTP 500")), false);
		assertTrue(mfl(JAH).getRetired());
	}

	@Test
	public void run_shouldAdoptASiteRootByItsMflUidAndKeepItsUuid() throws Exception {
		Location root = siteRoot("Barnersville Health Center", BARNERSVILLE);
		Location opd = new Location();
		opd.setName("Barnersville OPD");
		opd.setParentLocation(root);
		locations.saveLocation(opd);
		String rootUuid = root.getUuid();

		MflSyncEngine.Result result = run();

		assertEquals(FIXTURE_LOCATIONS - 1, result.getCounts().getCreated());
		assertNull("no second row for the facility", mfl(BARNERSVILLE));
		Location adopted = locations.getLocationByUuid(rootUuid);
		assertEquals("Barnersville HC", adopted.getName());
		assertEquals(mfl(SOMALIA_DRIVE), adopted.getParentLocation());
		assertEquals("seeded by the site package", adopted.getDescription());
		assertTrue("local tags stay", adopted.hasTag(MflConstants.TAG_LOGIN_LOCATION));
		assertTrue(adopted.hasTag(MflConstants.TAG_HEALTH_FACILITY));
		Location child = locations.getLocationByUuid(opd.getUuid());
		assertEquals("Barnersville OPD", child.getName());
		assertEquals(adopted, child.getParentLocation());
		assertEquals(MflAction.UPDATE, item(result, BARNERSVILLE).getAction());
	}

	@Test
	public void run_shouldNeverRetireThisInstancesOwnRoot() throws Exception {
		Location root = siteRoot("Barnersville Health Center", BARNERSVILLE);
		run();
		MflSyncEngine.Result result = run(without(MflFixture.units(), BARNERSVILLE), false);
		assertFalse(locations.getLocationByUuid(root.getUuid()).getRetired());
		MflRunItem item = item(result, BARNERSVILLE);
		assertEquals(MflAction.ERROR, item.getAction());
		assertThat(item.getError(), startsWith("Not retired: this instance's own facility root"));
		assertEquals(1, result.getCounts().getFailed());
	}

	@Test
	public void run_shouldReportTwoRowsHoldingOneMflUidAndTouchNeither() throws Exception {
		run();
		Location second = siteRoot("Jah Clinic, seeded", JAH);
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		MflSyncEngine.Result result = run(replace(MflFixture.units(), with(jah, "Jah Renamed", KPAAI, null)), false);
		MflRunItem item = item(result, JAH);
		assertEquals(MflAction.ERROR, item.getAction());
		assertThat(item.getError(), containsString("2 locations hold MFL UID nY6mPgT0Kc6"));
		assertEquals("Jah Clinic", mfl(JAH).getName());
		assertEquals("Jah Clinic, seeded", locations.getLocationByUuid(second.getUuid()).getName());
	}

	@Test
	public void run_shouldWriteNothingOnADryRun() throws Exception {
		int before = locations.getAllLocations(true).size();
		MflSyncEngine.Result result = run(MflFixture.units(), true);
		assertEquals(before, locations.getAllLocations(true).size());
		assertEquals(FIXTURE_LOCATIONS, result.getCounts().getCreated());
		assertEquals(MflAction.CREATE, item(result, JAH).getAction());
	}

	@Test
	public void run_shouldLeaveARealRunIdenticalToTheDryRunBeforeIt() throws Exception {
		run();
		MflUnit jah = MflFixture.unit(MflFixture.units(), JAH);
		List<MflUnit> changed = replace(MflFixture.units(), with(jah, "Jah Community Clinic", FUAMAH, null));
		MflSyncEngine.Result dry = run(changed, true);
		assertEquals("Jah Clinic", mfl(JAH).getName());
		MflSyncEngine.Result real = run(changed, false);
		assertEquals(dry.getCounts().getUpdated(), real.getCounts().getUpdated());
		assertEquals(item(dry, JAH).getChanges().size(), item(real, JAH).getChanges().size());
	}

	@Test
	public void run_shouldSuffixAnMflNameThatALocalLocationHolds() throws Exception {
		Location local = new Location();
		local.setName("Jah Clinic");
		locations.saveLocation(local);
		run();
		assertEquals("Jah Clinic (Kpaai)", mfl(JAH).getName());
		assertEquals("Jah Clinic", locations.getLocationByUuid(local.getUuid()).getName());
	}

	@Test
	public void run_shouldLeaveLocalFieldsAndTagsAlone() throws Exception {
		run();
		Location jah = mfl(JAH);
		jah.setDescription("Local note");
		jah.setAddress1("Main road");
		jah.addTag(locations.getLocationTagByName(MflConstants.TAG_LOGIN_LOCATION));
		locations.saveLocation(jah);
		Context.flushSession();
		MflSyncEngine.Result result = run();
		assertEquals("Local note", mfl(JAH).getDescription());
		assertEquals("Main road", mfl(JAH).getAddress1());
		assertTrue(mfl(JAH).hasTag(MflConstants.TAG_LOGIN_LOCATION));
		assertEquals(0, result.getCounts().getUpdated());
	}

	@Test
	public void run_shouldFailWhenTheContentMetadataIsMissing() {
		LocationAttributeType code = locations.getLocationAttributeTypeByUuid(MflConstants.ATTR_MFL_CODE);
		locations.purgeLocationAttributeType(code);
		try {
			run();
			fail("expected an MflException");
		}
		catch (MflException e) {
			assertThat(e.getMessage(), containsString(MflConstants.ATTR_MFL_CODE));
			assertThat(e.getMessage(), containsString("content-liberia-national"));
		}
	}
}
