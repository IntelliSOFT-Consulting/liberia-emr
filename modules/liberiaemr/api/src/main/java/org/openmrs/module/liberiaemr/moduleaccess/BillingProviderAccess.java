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
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.util.PrivilegeConstants;

/**
 * Call-scoped Get Providers for the cashier lookup a bill POST performs.
 * <p>
 * {@code BillResource.save} calls {@code ProviderUtil.getCurrentProvider}, which calls
 * {@code getProvidersByPerson}. A cashier sent on the bill is resolved by uuid during that same
 * POST. The privilege is added only while {@link BillingVisitAccess} is open and the caller already
 * holds billing write. Provider search is not advised.
 */
public final class BillingProviderAccess implements MethodInterceptor {

	public Object invoke(MethodInvocation invocation) throws Throwable {
		if (!BillingVisitAccess.openNow() || !ModuleAccess.BILLING.allows(ModulePrivileges.current(), Access.WRITE)) {
			return invocation.proceed();
		}
		boolean added = false;
		if (!Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS)) {
			Context.addProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
			added = true;
		}
		try {
			return invocation.proceed();
		}
		finally {
			if (added) {
				Context.removeProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
			}
		}
	}
}
