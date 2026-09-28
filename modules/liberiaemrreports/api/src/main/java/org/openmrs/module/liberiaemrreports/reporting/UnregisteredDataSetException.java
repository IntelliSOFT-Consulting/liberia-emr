/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reporting;

import org.openmrs.api.APIException;

/**
 * An {@link EtlSqlDataSetDefinition} was submitted for evaluation that this module did not build: an
 * ad-hoc or altered definition. It is refused before any SQL runs ({@link RegisteredEtlDataSets}).
 */
public class UnregisteredDataSetException extends APIException {

	private static final long serialVersionUID = 1L;

	public UnregisteredDataSetException(String message) {
		super(message);
	}
}
