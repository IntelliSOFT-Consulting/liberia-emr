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
import org.openmrs.api.context.Context;
import org.openmrs.util.PrivilegeConstants;

/**
 * Thread-local scope for one already-authorized {@code VisitService.saveVisit}.
 *
 * <p>Core's visit validator asks for that visit's encounters while the save is in progress.
 * {@link ModuleAccessGuard} uses this scope to answer that lookup with no encounters for a matrix
 * role that has no clinical read, without proxying {@code Get Encounters}. The scope is open only
 * when the caller already holds {@code Add Visits} for a new visit or {@code Edit Visits} for an
 * existing one, and it is cleared before {@code saveVisit} returns.
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

	/** The privilege {@code VisitServiceImpl.saveVisit} requires for this visit, already held. */
	private static boolean alreadyAuthorized(Object[] args) {
		Visit visit = null;
		if (args != null) {
			for (Object arg : args) {
				if (arg instanceof Visit) {
					visit = (Visit) arg;
					break;
				}
			}
		}
		if (visit == null) { return false; }
		String privilege = visit.getId() == null ? PrivilegeConstants.ADD_VISITS : PrivilegeConstants.EDIT_VISITS;
		return Context.hasPrivilege(privilege);
	}
}
