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

import java.util.Set;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.util.PrivilegeConstants;

/**
 * An order binds its orderer before OrderService runs. Laboratory or Pharmacy write already
 * authorizes that order. Only the single-provider lookup is proxied, and only for that call.
 */
public class OrderProviderAccess implements MethodInterceptor {
	@Override
	public Object invoke(MethodInvocation invocation) throws Throwable {
		String name = invocation.getMethod().getName();
		if (!"getProvider".equals(name) && !"getProviderByUuid".equals(name)) { return invocation.proceed(); }
		boolean added = false;
		try {
			Set<String> privileges = ModulePrivileges.current();
			boolean writer = ModuleAccess.LABORATORY.allows(privileges, Access.WRITE)
			        || ModuleAccess.PHARMACY.allows(privileges, Access.WRITE);
			if (writer && !Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS)) {
				Context.addProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
				added = true;
			}
		}
		catch (RuntimeException ignored) { }
		try {
			return invocation.proceed();
		}
		finally {
			if (added) {
				try { Context.removeProxyPrivilege(PrivilegeConstants.GET_PROVIDERS); }
				catch (RuntimeException ignored) { }
			}
		}
	}
}
