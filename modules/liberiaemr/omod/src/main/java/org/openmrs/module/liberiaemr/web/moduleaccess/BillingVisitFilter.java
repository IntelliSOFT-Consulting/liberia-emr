/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.moduleaccess;

import java.io.IOException;
import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.BillingVisitAccess;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.module.liberiaemr.moduleaccess.ModulePrivileges;

/**
 * Opens the billing visit lookup for a bill POST only. The visit-service advice adds Get Visits
 * after billing write is confirmed, and only for the lookup methods that bill save uses.
 * Bill JSON is left as the billing module wrote it: the visit property is a reference.
 */
public class BillingVisitFilter implements Filter {
	static final String MANAGE_CASHIER_METADATA = "Manage Cashier Metadata";

	@Override
	public void init(FilterConfig filterConfig) { }

	@Override
	public void destroy() { }

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
	        throws IOException, ServletException {
		HttpServletRequest http = (HttpServletRequest) request;
		if (!BillingVisitAccess.billSave(http.getMethod(), http.getRequestURI())) {
			chain.doFilter(request, response);
			return;
		}
		BillingVisitAccess.open();
		// Binding cashPoint checks Manage Cashier Metadata in the billing resource, before the
		// service advice can run. The proxy is added only for this bill POST, only when this
		// caller is authenticated and already holds billing write, and only when this caller does
		// not already hold it. It is removed before this filter returns. It is not saved on a role.
		// Saving a bill still requires Manage Cashier Bills.
		boolean added = false;
		if (Context.isAuthenticated()
		        && ModuleAccess.BILLING.allows(ModulePrivileges.current(), Access.WRITE)
		        && !Context.hasPrivilege(MANAGE_CASHIER_METADATA)) {
			Context.addProxyPrivilege(MANAGE_CASHIER_METADATA);
			added = true;
		}
		try {
			chain.doFilter(request, response);
		}
		finally {
			if (added) {
				try { Context.removeProxyPrivilege(MANAGE_CASHIER_METADATA); }
				catch (RuntimeException ignored) { }
			}
			BillingVisitAccess.close();
		}
	}
}
