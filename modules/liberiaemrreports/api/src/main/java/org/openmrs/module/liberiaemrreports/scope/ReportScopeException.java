/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.scope;

import org.openmrs.api.APIException;

/**
 * A report was requested for a location this instance may not report on, or the instance cannot
 * tell which facility it is. The run fails; it is never silently widened or narrowed.
 */
public class ReportScopeException extends APIException {
	
	private static final long serialVersionUID = 1L;
	
	public ReportScopeException(String message) {
		super(message);
	}
}
