/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.moduleaccess;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class OrderCareSettingFilterTest {
	@Test
	public void orderWritesAndCareSettingReadsAreCovered() {
		assertTrue(OrderCareSettingFilter.relevant("POST", "/openmrs/ws/rest/v1/order"));
		assertTrue(OrderCareSettingFilter.relevant("GET", "/openmrs/ws/rest/v1/caresetting"));
		assertTrue(OrderCareSettingFilter.relevant("POST", "/openmrs/ws/fhir2/R4/MedicationRequest"));
		assertTrue(OrderCareSettingFilter.relevant("PUT", "/openmrs/ws/fhir2/R4/ServiceRequest"));
		assertFalse(OrderCareSettingFilter.relevant("GET", "/openmrs/ws/rest/v1/order"));
		assertFalse(OrderCareSettingFilter.relevant("POST", "/openmrs/ws/rest/v1/encounter"));
		assertFalse(OrderCareSettingFilter.relevant("POST", "/openmrs/ws/fhir2/R4/Encounter"));
	}
}
