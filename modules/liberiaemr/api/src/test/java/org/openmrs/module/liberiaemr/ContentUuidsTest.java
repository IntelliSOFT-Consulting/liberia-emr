/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ContentUuidsTest {

	@Test
	public void acceptsDashedAndCielUuids() {
		assertTrue(ContentUuids.isUuid("38c602a1-e487-46ab-a231-e2a09ef61c29"));
		assertTrue(ContentUuids.isUuid("1421AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
		assertTrue(ContentUuids.isUuid("165907AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
	}

	@Test
	public void refusesAnUnfilteredTokenOrAMalformedValue() {
		assertFalse(ContentUuids.isUuid("${var.program.anc.uuid}"));
		assertFalse(ContentUuids.isUuid("1421AAAA"));
		assertFalse(ContentUuids.isUuid("AAAA1421AAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
		assertFalse(ContentUuids.isUuid("1421AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"));
		assertFalse(ContentUuids.isUuid(null));
	}
}
