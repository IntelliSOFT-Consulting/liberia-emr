/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Whether this instance is central or a facility, read from {@value #ENVIRONMENT_VARIABLE}, which
 * each compose file hard-codes. Same rule as liberiaemrreports' InstanceRole (ADR 0010 decision 5):
 * it <b>fails closed</b>, so unset, blank or unknown means {@link #FACILITY}.
 */
public enum InstanceRole {

	FACILITY,
	CENTRAL;

	public static final String ENVIRONMENT_VARIABLE = "LIBERIAEMR_INSTANCE_ROLE";

	private static final Logger log = LoggerFactory.getLogger(InstanceRole.class);

	/** @return the role this process was started with */
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
			log.warn("{}='{}' is not facility or central; treating this instance as a facility", ENVIRONMENT_VARIABLE,
			    value);
		}
		return FACILITY;
	}
}
