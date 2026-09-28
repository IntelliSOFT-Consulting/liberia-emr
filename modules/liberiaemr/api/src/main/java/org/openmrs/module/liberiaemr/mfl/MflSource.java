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

/** Where a run gets the MFL from: the DHIS2 client in production, a fixture in tests. */
public interface MflSource {
	
	/**
	 * @return every county, district and facility; incomplete when a page did not arrive
	 * @throws MflException when nothing usable arrived, or the MFL refused the account
	 */
	MflSnapshot fetch() throws MflException;
}
