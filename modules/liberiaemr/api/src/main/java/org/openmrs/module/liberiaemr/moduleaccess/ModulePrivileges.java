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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;

/** Effective module privileges, and whether this user is inside the nine-role matrix. */
public final class ModulePrivileges {
	static final List<String> MATRIX_ROLES = Collections.unmodifiableList(Arrays.asList("Registrar", "Nurse",
	        "Physician Assistant", "Lab Technician", "Pharmacist", "Midwife", "Finance", "Systems Administrator",
	        "Facility in-charge"));

	private ModulePrivileges() { }

	/** True when the user holds at least one matrix role, including through inheritance. */
	public static boolean matrixRole() {
		if (!Context.isAuthenticated()) { return false; }
		User user = Context.getAuthenticatedUser();
		if (user == null) { return false; }
		Set<Role> roles = user.getAllRoles();
		if (roles == null) { return false; }
		for (Role role : roles) {
			if (role != null && MATRIX_ROLES.contains(role.getName())) { return true; }
		}
		return false;
	}

	public static Set<String> current() {
		if (!Context.isAuthenticated()) { return Collections.emptySet(); }
		Set<String> names = new HashSet<>();
		for (ModuleAccess module : ModuleAccess.values()) {
			for (String privilege : module.readPrivileges()) {
				if (Context.hasPrivilege(privilege)) { names.add(privilege); }
			}
			for (String privilege : module.writePrivileges()) {
				if (Context.hasPrivilege(privilege)) { names.add(privilege); }
			}
		}
		return names;
	}

	/**
	 * The user's own role privilege. {@code Context.hasPrivilege} is also true for a proxy added
	 * for the current call, and that must not be treated as a standing grant.
	 */
	public static boolean own(String privilege) {
		if (!Context.isAuthenticated()) { return false; }
		User user = Context.getAuthenticatedUser();
		return user != null && user.hasPrivilege(privilege);
	}

	public static boolean anyClinicalRead(Collection<String> privileges) {
		for (ModuleAccess module : ModuleAccess.values()) {
			// Appointments is its own privilege bundle. Counting it here would proxy Get Encounters for Registrar.
			if (module == ModuleAccess.REGISTRATION || module == ModuleAccess.BILLING
			        || module == ModuleAccess.APPOINTMENTS) {
				continue;
			}
			if (module.allows(privileges, Access.READ)) { return true; }
		}
		return false;
	}
}
