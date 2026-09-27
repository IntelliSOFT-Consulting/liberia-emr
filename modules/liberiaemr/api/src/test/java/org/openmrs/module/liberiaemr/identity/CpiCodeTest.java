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
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public class CpiCodeTest {

	@Test
	public void generate_shouldMatchTheReadableFormat() {
		for (int i = 0; i < 1000; i++) {
			String code = CpiCode.generate();
			assertTrue(code, code.matches("LR-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z*~$=U]"));
			assertTrue(code, CpiCode.isValid(code));
		}
	}

	@Test
	public void generate_shouldNotRepeatInASmallSample() {
		Set<String> seen = new HashSet<String>();
		for (int i = 0; i < 10000; i++) {
			assertTrue(seen.add(CpiCode.generate()));
		}
	}

	@Test
	public void format_shouldBeStableForAValue() {
		assertEquals("LR-00000-00000-0", CpiCode.format(0));
		assertEquals("LR-00000-00001-1", CpiCode.format(1));
		assertEquals(CpiCode.format(123456789012L), CpiCode.format(123456789012L));
	}

	@Test
	public void isValid_shouldCatchATranscriptionError() {
		String code = CpiCode.format(987654321098L);
		char[] wrong = code.toCharArray();
		wrong[4] = wrong[4] == '7' ? '8' : '7';
		assertFalse(CpiCode.isValid(new String(wrong)));
		assertFalse(CpiCode.isValid(code.substring(0, 15)));
		assertFalse(CpiCode.isValid(null));
	}

	@Test
	public void isValid_shouldForgiveTheConfusableLettersAndCase() {
		String code = CpiCode.format(1L << 45);
		assertTrue(CpiCode.isValid(code.toLowerCase().replace('0', 'O')));
	}
}
