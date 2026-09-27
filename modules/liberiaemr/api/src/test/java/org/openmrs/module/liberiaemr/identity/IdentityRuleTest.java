/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.sql.Date;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

/** The sanity check that gates an exact National ID match (sync-eip.md 2.2 rule 4). */
public class IdentityRuleTest {

	private static Map<String, Object> person(String sex, String dob, int estimated) {
		Map<String, Object> row = new HashMap<String, Object>();
		row.put("gender", sex);
		row.put("birthdate", dob == null ? null : Date.valueOf(dob));
		row.put("birthdate_estimated", estimated);
		return row;
	}

	@Test
	public void agrees_whenSexAndDocumentedDateOfBirthMatch() {
		assertNull(IdentityService.disagreement(person("F", "1990-04-01", 0), person("f", "1990-04-01", 0), 0));
	}

	@Test
	public void disagrees_whenSexDiffers() {
		assertEquals("sex differs", IdentityService.disagreement(person("F", "1990-04-01", 0), person("M", "1990-04-01", 0), 0));
	}

	@Test
	public void disagrees_whenDocumentedDatesDifferBeyondTolerance() {
		assertEquals("date of birth differs",
		    IdentityService.disagreement(person("F", "1990-04-01", 0), person("F", "1990-04-03", 0), 1));
		assertNull(IdentityService.disagreement(person("F", "1990-04-01", 0), person("F", "1990-04-03", 0), 2));
	}

	@Test
	public void estimatedDates_compareByYearOnly() {
		assertNull(IdentityService.disagreement(person("F", "1990-01-01", 1), person("F", "1990-11-20", 0), 0));
		assertEquals("estimated dates of birth are in different years",
		    IdentityService.disagreement(person("F", "1990-01-01", 1), person("F", "1991-01-01", 1), 0));
	}

	@Test
	public void missingFacts_neverAgree() {
		assertEquals("sex is not recorded on both", IdentityService.disagreement(person(null, "1990-04-01", 0),
		    person("F", "1990-04-01", 0), 0));
		assertEquals("date of birth is not recorded on both",
		    IdentityService.disagreement(person("F", null, 0), person("F", "1990-04-01", 0), 0));
	}
}
