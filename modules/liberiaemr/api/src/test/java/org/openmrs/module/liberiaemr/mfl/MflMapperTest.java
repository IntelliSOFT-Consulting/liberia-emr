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

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class MflMapperTest {

	private static final String BONG = "EriWrruEGwa";

	private static final String KPAAI = "TSrmxt9mnrS";

	private static final Set<String> NO_LOCAL_NAMES = Collections.<String> emptySet();

	private static Map<String, MflLocationSpec> byUid(List<MflLocationSpec> specs) {
		Map<String, MflLocationSpec> byUid = new LinkedHashMap<String, MflLocationSpec>();
		for (MflLocationSpec spec : specs) {
			byUid.put(spec.getUid(), spec);
		}
		return byUid;
	}

	private static Map<String, MflLocationSpec> mapFixture() {
		return byUid(MflMapper.map(MflFixture.units(), NO_LOCAL_NAMES));
	}

	private static MflLocationSpec mapOne(List<MflUnit> extra, String uid) {
		List<MflUnit> units = new ArrayList<MflUnit>(MflFixture.units());
		units.addAll(extra);
		return byUid(MflMapper.map(units, NO_LOCAL_NAMES)).get(uid);
	}

	@Test
	public void map_shouldSkipTheCountryAndLevel3UnitsWithoutFacilities() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertTrue(!specs.containsKey("LHNiyIWuLdc"));
		assertTrue("CHT - Bong holds no facility", !specs.containsKey("UkXuMDgeakb"));
		// 2 counties, 5 districts that hold a facility, 16 facilities
		assertEquals(23, specs.size());
	}

	@Test
	public void map_shouldOrderCountiesThenDistrictsThenFacilities() {
		List<MflLocationSpec> specs = MflMapper.map(MflFixture.units(), NO_LOCAL_NAMES);
		MflLevel previous = MflLevel.COUNTY;
		for (MflLocationSpec spec : specs) {
			assertTrue(spec.getLevel().ordinal() >= previous.ordinal());
			previous = spec.getLevel();
		}
	}

	@Test
	public void map_shouldGiveEachLevelItsTagAndParent() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertEquals(MflLevel.COUNTY, specs.get(BONG).getLevel());
		assertNull(specs.get(BONG).getParentUid());
		assertEquals("County", specs.get(BONG).getLevel().getTag());
		assertEquals(BONG, specs.get(KPAAI).getParentUid());
		assertEquals("District", specs.get(KPAAI).getLevel().getTag());
		assertEquals(KPAAI, specs.get("nY6mPgT0Kc6").getParentUid());
		assertEquals("Health Facility", specs.get("nY6mPgT0Kc6").getLevel().getTag());
	}

	@Test
	public void map_shouldTrimNamesAndCollapseWhitespace() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertEquals("Jah Clinic", specs.get("nY6mPgT0Kc6").getName());
		assertEquals("Liberia Center for Infectious Disease", specs.get("WjPvpeQkiC6").getName());
		MflLocationSpec doubled = mapOne(java.util.Arrays.asList(MflFixture.facility("x1", "Newaken  \tClinic", KPAAI)),
		    "x1");
		assertEquals("Newaken Clinic", doubled.getName());
	}

	@Test
	public void map_shouldSuffixEveryUnitThatSharesANameCaseInsensitively() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertEquals("Fredai Medical Clinic (Careysburg District)", specs.get("ND0PnHCbt8t").getName());
		assertEquals("FREDAI Medical Clinic (Somalia Drive District)", specs.get("jKkdlhkGyr9").getName());
		assertThat(specs.get("ND0PnHCbt8t").getWarnings(),
		    hasItem("Name: another location is also called 'Fredai Medical Clinic'; named 'Fredai Medical Clinic (Careysburg District)'"));
	}

	/**
	 * OpenMRS rejects saving even a retired location whose name an active one holds, so a closed
	 * unit counts as a clash too.
	 */
	@Test
	public void map_shouldSuffixAClosedUnitAndTheActiveUnitThatSharesItsName() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertEquals("Jamaica Rd Clinic (Bushrod District)", specs.get("ucTzZhF5okn").getName());
		assertEquals("Jamaica Rd Clinic (Somalia Drive District)", specs.get("ZktsAIReh6z").getName());
	}

	@Test
	public void map_shouldSuffixANameALocalLocationAlreadyHolds() {
		Set<String> local = new HashSet<String>();
		local.add("jah clinic");
		MflLocationSpec jah = byUid(MflMapper.map(MflFixture.units(), local)).get("nY6mPgT0Kc6");
		assertEquals("Jah Clinic (Kpaai)", jah.getName());
	}

	@Test
	public void map_shouldNotSuffixAUniqueName() {
		MflLocationSpec jah = mapFixture().get("nY6mPgT0Kc6");
		assertEquals("Jah Clinic", jah.getName());
		assertThat(jah.getWarnings(), empty());
	}

	@Test
	public void map_shouldTrimTheCodeAndLeaveAMissingCodeEmpty() {
		Map<String, MflLocationSpec> specs = mapFixture();
		assertEquals("LBR-06-0602-02", specs.get("FNSAES9Meck").getAttribute(MflConstants.ATTR_MFL_CODE));
		assertNull(specs.get("LDoJbUPbnU4").getAttribute(MflConstants.ATTR_MFL_CODE));
		assertEquals("pqX9sGzFbDV", specs.get("pqX9sGzFbDV").getAttribute(MflConstants.ATTR_MFL_UID));
	}

	@Test
	public void map_shouldSwapThePointIntoLatitudeAndLongitude() {
		MflLocationSpec jah = mapFixture().get("nY6mPgT0Kc6");
		assertEquals("6.814444", jah.getLatitude());
		assertEquals("-9.186944", jah.getLongitude());
		MflLocationSpec noPoint = mapFixture().get("bP0PeqBGKgB");
		assertNull(noPoint.getLatitude());
		assertNull(noPoint.getLongitude());
	}

	@Test
	public void map_shouldWarnWhenAPointIsOutsideLiberia() {
		MflUnit far = new MflUnit("x2", null, "Nekeborzu clinic", 4, KPAAI, null, null, "9.05", "-9.5",
		        new HashSet<String>());
		MflLocationSpec spec = mapOne(java.util.Arrays.asList(far), "x2");
		assertEquals("9.05", spec.getLatitude());
		assertThat(spec.getWarnings(), contains("Point 9.05, -9.5 is outside Liberia"));
	}

	@Test
	public void map_shouldFillTheAddressFromTheCountyAndDistrict() {
		Map<String, MflLocationSpec> specs = mapFixture();
		MflLocationSpec jah = specs.get("nY6mPgT0Kc6");
		assertEquals("Bong", jah.getStateProvince());
		assertEquals("Kpaai", jah.getCountyDistrict());
		assertEquals("Liberia", jah.getCountry());
		assertEquals("Bong", specs.get(KPAAI).getStateProvince());
		assertEquals("Kpaai", specs.get(KPAAI).getCountyDistrict());
		assertEquals("Bong", specs.get(BONG).getStateProvince());
		assertNull(specs.get(BONG).getCountyDistrict());
	}

	@Test
	public void map_shouldMapTypeOwnershipEmoncAndSettingByGroupUid() {
		MflLocationSpec bensonville = mapFixture().get("nKYHK0QO2K7");
		assertEquals("Hospital", bensonville.getAttribute(MflConstants.ATTR_FACILITY_TYPE));
		assertEquals("Public", bensonville.getAttribute(MflConstants.ATTR_FACILITY_OWNERSHIP));
		assertEquals("CEmONC", bensonville.getAttribute(MflConstants.ATTR_EMONC_LEVEL));
		assertEquals("Urban", bensonville.getAttribute(MflConstants.ATTR_FACILITY_SETTING));
		MflLocationSpec barnersville = mapFixture().get("kueVlXwUXiI");
		assertEquals("Health Center", barnersville.getAttribute(MflConstants.ATTR_FACILITY_TYPE));
		assertEquals("BEmONC", barnersville.getAttribute(MflConstants.ATTR_EMONC_LEVEL));
	}

	@Test
	public void map_shouldLeaveAnAttributeEmptyWhenTheFacilityIsInNoneOfItsGroups() {
		MflLocationSpec comeAndSee = mapFixture().get("bP0PeqBGKgB");
		assertNull(comeAndSee.getAttribute(MflConstants.ATTR_FACILITY_TYPE));
		assertNull(comeAndSee.getAttribute(MflConstants.ATTR_FACILITY_OWNERSHIP));
		assertTrue(comeAndSee.getAttributes().containsKey(MflConstants.ATTR_FACILITY_TYPE));
	}

	@Test
	public void map_shouldPreferHealthCenterOverClinicAndWarn() {
		MflLocationSpec kesselee = mapFixture().get("VxgfT09KRV4");
		assertEquals("Health Center", kesselee.getAttribute(MflConstants.ATTR_FACILITY_TYPE));
		assertThat(kesselee.getWarnings(), contains("Facility Type: in Clinic and Health Center; Health Center wins"));
	}

	@Test
	public void map_shouldLetTheOtherOwnershipWinOverPrivate() {
		MflLocationSpec spec = mapOne(
		    java.util.Arrays.asList(MflFixture.facility("x3", "Owned Twice", KPAAI, MflConstants.GROUP_PRIVATE,
		        MflConstants.GROUP_FAITH_BASED)), "x3");
		assertEquals("Faith Based", spec.getAttribute(MflConstants.ATTR_FACILITY_OWNERSHIP));
		assertThat(spec.getWarnings(), contains("Facility Ownership: in Faith Based and Private; Faith Based wins"));
	}

	@Test
	public void map_shouldLeaveOwnershipEmptyForAnyOtherPair() {
		MflLocationSpec spec = mapOne(
		    java.util.Arrays.asList(MflFixture.facility("x4", "Public and Faith", KPAAI, MflConstants.GROUP_PUBLIC,
		        MflConstants.GROUP_FAITH_BASED)), "x4");
		assertNull(spec.getAttribute(MflConstants.ATTR_FACILITY_OWNERSHIP));
		assertThat(spec.getWarnings(), contains("Facility Ownership: in Faith Based and Public; left empty"));
	}

	@Test
	public void map_shouldPreferCemoncAndLeaveABothSettingEmpty() {
		MflLocationSpec spec = mapOne(
		    java.util.Arrays.asList(MflFixture.facility("x5", "Both Everything", KPAAI, MflConstants.GROUP_BEMONC,
		        MflConstants.GROUP_CEMONC, MflConstants.GROUP_RURAL, MflConstants.GROUP_URBAN)), "x5");
		assertEquals("CEmONC", spec.getAttribute(MflConstants.ATTR_EMONC_LEVEL));
		assertNull(spec.getAttribute(MflConstants.ATTR_FACILITY_SETTING));
		assertThat(spec.getWarnings(), contains("EmONC Level: in BemONC and CEmONC; CEmONC wins",
		    "Facility Setting: in Rural and Urban; left empty"));
	}

	@Test
	public void map_shouldCarryTheClosedDateAndLastUpdated() {
		Map<String, MflLocationSpec> specs = mapFixture();
		MflLocationSpec closed = specs.get("ucTzZhF5okn");
		assertEquals("2026-04-01", closed.getClosedDate());
		assertEquals("2026-04-01", closed.getAttribute(MflConstants.ATTR_MFL_CLOSED_DATE));
		assertNull(specs.get("ZktsAIReh6z").getClosedDate());
		assertEquals("2026-06-20T21:48:12.934", specs.get("nY6mPgT0Kc6").getAttribute(MflConstants.ATTR_MFL_LAST_UPDATED));
	}

	@Test
	public void map_shouldNotSetFacilityAttributesOnCountiesOrDistricts() {
		MflLocationSpec bong = mapFixture().get(BONG);
		assertTrue(!bong.getAttributes().containsKey(MflConstants.ATTR_FACILITY_TYPE));
		assertNull(bong.getLatitude());
	}
}
