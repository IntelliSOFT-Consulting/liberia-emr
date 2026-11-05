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

import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.openmrs.Visit;
import org.openmrs.util.PrivilegeConstants;

/**
 * Thread-local scope for one already-authorized {@code VisitService.saveVisit} or
 * {@code VisitService.endVisit}.
 *
 * <p>Core's {@code VisitValidator} reads that visit's encounters during the call to check that
 * they fall within the visit's start and stop dates. {@link ModuleAccessGuard} uses this scope to
 * proxy {@code Get Encounters} for that lookup only, so the check still runs for a matrix role
 * such as Registrar that has no encounter read. The scope is open only when the caller's own roles
 * hold {@code Add Visits} for a new visit or {@code Edit Visits} for an existing one (a proxy
 * privilege does not count), and it is cleared before the call returns or throws.
 */
public final class VisitSaveEncounterScope implements MethodInterceptor {
	private static final ThreadLocal<Integer> DEPTH = new ThreadLocal<>();

	/** True only inside an authorized visit save on this thread. */
	public static boolean openNow() {
		Integer depth = DEPTH.get();
		return depth != null && depth > 0;
	}

	@Override
	public Object invoke(MethodInvocation invocation) throws Throwable {
		if (!ModulePrivileges.matrixRole() || !alreadyAuthorized(invocation.getArguments())) {
			return invocation.proceed();
		}
		int depth = DEPTH.get() == null ? 0 : DEPTH.get();
		DEPTH.set(depth + 1);
		try {
			return invocation.proceed();
		}
		finally {
			if (depth == 0) { DEPTH.remove(); }
			else { DEPTH.set(depth); }
		}
	}

	/**
	 * The visit is the first argument of both {@code saveVisit(Visit)} and
	 * {@code endVisit(Visit, Date)}. Core requires Add Visits for a new visit and Edit Visits for
	 * an existing one; this only checks that the caller's own roles already hold it, and core still
	 * enforces its own check on the call.
	 */
	private static boolean alreadyAuthorized(Object[] args) {
		if (args == null || args.length == 0 || !(args[0] instanceof Visit)) { return false; }
		Visit visit = (Visit) args[0];
		return ModulePrivileges.own(visit.getId() == null ? PrivilegeConstants.ADD_VISITS : PrivilegeConstants.EDIT_VISITS);
	}
}
