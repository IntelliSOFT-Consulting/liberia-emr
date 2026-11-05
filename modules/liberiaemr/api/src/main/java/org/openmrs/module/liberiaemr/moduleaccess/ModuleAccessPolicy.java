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

import java.util.Collection;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership;

/** Module decisions for a user who holds one of the nine matrix roles. */
public final class ModuleAccessPolicy {
	public enum Verdict { ALLOW, DENY }

	private ModuleAccessPolicy() { }

	public static Verdict read(Ownership ownership, Collection<String> privileges) {
		if (ownership == null) { return Verdict.DENY; }
		if (ownership.isUnrelated() || ownership.excluded) { return Verdict.ALLOW; }
		if (ownership.ambiguous || ownership.module == null) { return Verdict.DENY; }
		return ownership.module.allows(privileges, Access.READ) ? Verdict.ALLOW : Verdict.DENY;
	}

	public static Verdict create(Ownership ownership, Collection<String> privileges) {
		if (ownership == null) { return Verdict.DENY; }
		if (ownership.isUnrelated() || ownership.excluded) { return Verdict.ALLOW; }
		if (ownership.ambiguous || ownership.module == null) { return Verdict.DENY; }
		return ownership.module.allows(privileges, Access.WRITE) ? Verdict.ALLOW : Verdict.DENY;
	}

	/**
	 * Authorize the persisted module, then the module that would remain. Moving a protected
	 * record onto Vitals, onto an unrelated type, or onto another module requires write on both
	 * sides. Ambiguous provenance fails closed.
	 */
	public static Verdict update(Ownership before, Ownership after, Collection<String> privileges) {
		if (before == null || after == null || before.ambiguous || after.ambiguous) { return Verdict.DENY; }
		if (before.module != null) {
			if (!before.module.allows(privileges, Access.WRITE)) { return Verdict.DENY; }
			if (after.module != before.module) {
				return after.module != null && after.module.allows(privileges, Access.WRITE) ? Verdict.ALLOW : Verdict.DENY;
			}
			return Verdict.ALLOW;
		}
		if (after.module != null) {
			return after.module.allows(privileges, Access.WRITE) ? Verdict.ALLOW : Verdict.DENY;
		}
		return Verdict.ALLOW;
	}

	public static Verdict destroy(Ownership before, Collection<String> privileges) {
		return update(before, before, privileges);
	}
}
