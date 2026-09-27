/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.uuid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.Test;
import org.openmrs.api.APIException;

/**
 * The UUID file is filtered from content by the build; these fail if it was not.
 */
public class ReportUuidsTest {
	
	@Test
	public void everySheetShouldHaveThreeDistinctResolvedUuids() {
		Set<String> seen = new HashSet<String>();
		for (ReportSheet sheet : ReportSheet.values()) {
			seen.add(sheet.getReportUuid());
			seen.add(sheet.getCsvDesignUuid());
			seen.add(sheet.getExcelDesignUuid());
		}
		assertEquals(3 * ReportSheet.values().length, seen.size());
	}
	
	@Test
	public void theFileShouldDeclareExactlyTheSheetVariables() {
		Set<String> expected = new HashSet<String>();
		for (ReportSheet sheet : ReportSheet.values()) {
			expected.add("var.report." + sheet.getKey() + ".uuid");
			expected.add("var.reportdesign." + sheet.getKey() + "-csv.uuid");
			expected.add("var.reportdesign." + sheet.getKey() + "-xlsx.uuid");
		}
		assertEquals(expected, ReportUuids.variables());
	}
	
	@Test
	public void get_shouldRefuseAnUndeclaredVariable() {
		try {
			ReportUuids.get("var.report.unknown.uuid");
		}
		catch (APIException expected) {
			assertTrue(expected.getMessage().contains("var.report.unknown.uuid"));
			return;
		}
		throw new AssertionError("an undeclared variable resolved");
	}
}
