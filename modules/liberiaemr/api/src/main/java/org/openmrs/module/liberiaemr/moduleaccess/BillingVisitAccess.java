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

import java.util.regex.Pattern;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.util.PrivilegeConstants;

/**
 * Call-scoped Get Visits for the billing 2.3.0 save path only.
 *
 * <p>{@code BillResource.save} calls {@code VisitService.getActiveVisitsByPatient} when the bill
 * has no visit. That implementation calls {@code getVisitsByPatient} on the service proxy, so the
 * privilege has to still be held for that inner call. A supplied visit is resolved by
 * {@code getVisit} or {@code getVisitByUuid} while the representation is bound, which is the same
 * POST. No other visit method is advised, so a bill save cannot list visits.
 *
 * <p>The privilege is added only while a bill POST is open and the caller already holds billing
 * write. It is removed before the advised method returns, including when the method throws.
 */
public final class BillingVisitAccess implements MethodInterceptor {
	private static final Pattern BILL_SAVE = Pattern
	        .compile(".*/ws/rest/v1/billing/bill(?:/[^?]*)?(?:\\?.*)?$");
	private static final ThreadLocal<Boolean> OPEN = new ThreadLocal<>();

	/** True for the bill create/update POST, not for bill search or billable-service metadata. */
	public static boolean billSave(String method, String uri) {
		return method != null && "POST".equalsIgnoreCase(method) && uri != null && BILL_SAVE.matcher(uri).matches();
	}

	public static void open() { OPEN.set(Boolean.TRUE); }

	public static void close() { OPEN.remove(); }

	public static boolean openNow() { return OPEN.get() != null; }

	@Override
	public Object invoke(MethodInvocation invocation) throws Throwable {
		if (OPEN.get() == null || !ModuleAccess.BILLING.allows(ModulePrivileges.current(), Access.WRITE)) {
			return invocation.proceed();
		}
		boolean added = false;
		if (!Context.hasPrivilege(PrivilegeConstants.GET_VISITS)) {
			Context.addProxyPrivilege(PrivilegeConstants.GET_VISITS);
			added = true;
		}
		try {
			return invocation.proceed();
		}
		finally {
			if (added) { Context.removeProxyPrivilege(PrivilegeConstants.GET_VISITS); }
		}
	}
}
