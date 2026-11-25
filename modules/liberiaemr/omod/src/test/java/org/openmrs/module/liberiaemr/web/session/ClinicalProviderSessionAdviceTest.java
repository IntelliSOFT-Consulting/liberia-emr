/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.session;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.openmrs.module.webservices.rest.SimpleObject;

public class ClinicalProviderSessionAdviceTest {

	@Test
	public void actsOnlyOnASessionWhoseCurrentProviderIsNull() {
		assertTrue(ClinicalProviderSessionAdvice.lacksProvider(new SimpleObject().add("currentProvider", null)));
		assertFalse(ClinicalProviderSessionAdvice.lacksProvider(
		    new SimpleObject().add("currentProvider", new SimpleObject().add("uuid", "p"))));
		// An unauthenticated session has no currentProvider key at all.
		assertFalse(ClinicalProviderSessionAdvice.lacksProvider(new SimpleObject().add("authenticated", false)));
		assertFalse(ClinicalProviderSessionAdvice.lacksProvider("not a session"));
	}
}
