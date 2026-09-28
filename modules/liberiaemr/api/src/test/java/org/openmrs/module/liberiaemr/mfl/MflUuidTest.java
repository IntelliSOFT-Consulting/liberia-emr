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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

public class MflUuidTest {

	/** The worked examples in ADR 0009 decision 1: every instance must derive exactly these. */
	@Test
	public void forUid_shouldMatchTheAdrWorkedExamples() {
		assertEquals("7dd5a981-7e3a-59fa-b1fa-e1474e299da8", MflUuid.forUid("nY6mPgT0Kc6"));
		assertEquals("44a79c82-0b97-5487-8057-19ad9616f10e", MflUuid.forUid("TSrmxt9mnrS"));
	}

	@Test
	public void forUid_shouldBeCaseSensitive() {
		assertNotEquals(MflUuid.forUid("nY6mPgT0Kc6"), MflUuid.forUid("ny6mpgt0kc6"));
	}
}
