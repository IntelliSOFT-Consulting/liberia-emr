/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.moduleaccess;

import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * The approved module entitlements. Registration and billing name the existing OpenMRS bundles.
 * Clinical modules add a privilege OpenMRS does not have. These checks supplement operation
 * privileges; they do not replace them.
 */
public enum ModuleAccess {
	REGISTRATION(new String[] { "Get Patients", "Get People", "Get Patient Identifiers", "Get Relationships" },
	        new String[] { "Get Patients", "Get People", "Get Patient Identifiers", "Get Relationships", "Add Patients",
	                "Edit Patients", "Add People", "Edit People", "Add Patient Identifiers", "Edit Patient Identifiers",
	                "Add Relationships", "Edit Relationships" }),
	TB_SCREENING("Read TB Screening", "Write TB Screening"),
	GENERAL_CONSULTATION("Manage General Consultation"),
	BILLING(new String[] { "View Cashier Bills", "Manage Cashier Bills", "View Cashier Metadata" },
	        new String[] { "View Cashier Bills", "Manage Cashier Bills", "View Cashier Metadata" }),
	ANC("Manage ANC"),
	LABORATORY("Manage Laboratory"),
	PNC("Manage PNC"),
	PHARMACY("Manage Pharmacy"),
	LABOR_AND_DELIVERY("Read Labor and Delivery", "Write Labor and Delivery"),
	IMMUNIZATION("Read Immunization", "Write Immunization"),
	FAMILY_PLANNING("Manage Family Planning");

	public enum Access { NONE, READ, WRITE }

	private final List<String> readPrivileges;
	private final List<String> writePrivileges;

	ModuleAccess(String manage) {
		this(manage, manage);
	}

	ModuleAccess(String read, String write) {
		this(new String[] { read }, new String[] { write });
	}

	ModuleAccess(String[] read, String[] write) {
		readPrivileges = Collections.unmodifiableList(Arrays.asList(read));
		writePrivileges = Collections.unmodifiableList(Arrays.asList(write));
	}

	public List<String> readPrivileges() { return readPrivileges; }

	public List<String> writePrivileges() { return writePrivileges; }

	/** Effective privileges of the authenticated user, never a request body. */
	public Access access(Collection<String> effectivePrivileges) {
		if (effectivePrivileges == null) { return Access.NONE; }
		if (effectivePrivileges.containsAll(writePrivileges)) { return Access.WRITE; }
		if (effectivePrivileges.containsAll(readPrivileges)) { return Access.READ; }
		return Access.NONE;
	}

	/** Write implies read here. OpenMRS does not imply that. */
	public boolean allows(Collection<String> effectivePrivileges, Access requested) {
		Access actual = access(effectivePrivileges);
		return requested == Access.READ ? actual != Access.NONE : requested == Access.WRITE && actual == Access.WRITE;
	}
}
