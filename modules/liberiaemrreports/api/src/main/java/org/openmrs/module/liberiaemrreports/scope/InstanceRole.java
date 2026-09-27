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

import java.util.Locale;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;

/**
 * Whether this instance reports on itself (a facility) or on any MFL node (central).
 * <p>
 * Read from {@value #ENVIRONMENT_VARIABLE}, which each compose file hard-codes (ADR 0010 decision
 * 5). It <b>fails closed</b>: unset, blank or unknown means {@link #FACILITY}, the narrower scope.
 * The role is never inferred from other settings.
 */
public enum InstanceRole {
	
	FACILITY,
	CENTRAL;
	
	public static final String ENVIRONMENT_VARIABLE = "LIBERIAEMR_INSTANCE_ROLE";
	
	private static final Log log = LogFactory.getLog(InstanceRole.class);
	
	/**
	 * @return the role this process was started with
	 */
	public static InstanceRole current() {
		return parse(System.getenv(ENVIRONMENT_VARIABLE));
	}
	
	/**
	 * @param value the raw environment value, possibly null
	 * @return {@link #CENTRAL} only for the literal {@code central} (case and surrounding space
	 *         ignored); {@link #FACILITY} for anything else
	 */
	public static InstanceRole parse(String value) {
		if (value == null || value.trim().isEmpty()) {
			return FACILITY;
		}
		String v = value.trim().toLowerCase(Locale.ROOT);
		if ("central".equals(v)) {
			return CENTRAL;
		}
		if (!"facility".equals(v)) {
			log.warn(
			    ENVIRONMENT_VARIABLE + "='" + value + "' is not facility or central; treating this instance as a facility");
		}
		return FACILITY;
	}
}
