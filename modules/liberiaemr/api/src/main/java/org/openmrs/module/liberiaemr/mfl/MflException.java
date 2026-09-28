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

/**
 * A run cannot go on: the MFL is unreachable, refused the account, or this instance is missing
 * something the sync needs. The message is shown to administrators as is, so it never carries a
 * credential.
 */
public class MflException extends Exception {
	
	public MflException(String message) {
		super(message);
	}
}
