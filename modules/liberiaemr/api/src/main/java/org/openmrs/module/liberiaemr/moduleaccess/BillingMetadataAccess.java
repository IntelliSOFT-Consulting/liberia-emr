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

/**
 * Cashier 2.3.0 checks Manage Cashier Metadata on cash-point reads. The approved billing bundle
 * grants View Cashier Metadata and does not grant cash-point create, retire, or purge.
 * <p>
 * The manage privilege is added only for a get, and only after billing read is already allowed. It
 * is removed before the method returns, including when the method throws.
 */
public final class BillingMetadataAccess implements MethodInterceptor {

	static final String MANAGE_CASHIER_METADATA = "Manage Cashier Metadata";

	public Object invoke(MethodInvocation invocation) throws Throwable {
		String name = invocation.getMethod().getName();
		if (name == null || !name.startsWith("get") || !ModuleAccess.BILLING.allows(ModulePrivileges.current(), Access.READ)) {
			return invocation.proceed();
		}
		boolean added = false;
		if (!Context.hasPrivilege(MANAGE_CASHIER_METADATA)) {
			Context.addProxyPrivilege(MANAGE_CASHIER_METADATA);
			added = true;
		}
		try {
			return invocation.proceed();
		}
		finally {
			if (added) {
				Context.removeProxyPrivilege(MANAGE_CASHIER_METADATA);
			}
		}
	}
}
