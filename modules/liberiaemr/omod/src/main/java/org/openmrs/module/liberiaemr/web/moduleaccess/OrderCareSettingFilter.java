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
import org.openmrs.util.PrivilegeConstants;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.module.liberiaemr.moduleaccess.ModulePrivileges;

/**
 * Order and FHIR medication/service requests bind the care setting before OrderService runs.
 * A service-level proxy is too late for that bind. Laboratory or Pharmacy write already
 * authorizes the order; this adds Get Care Settings for that request only.
 */
public class OrderCareSettingFilter implements Filter {
	@Override
	public void init(FilterConfig filterConfig) { }

	@Override
	public void destroy() { }

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
	        throws IOException, ServletException {
		HttpServletRequest http = (HttpServletRequest) request;
		if (!relevant(http.getMethod(), http.getRequestURI())) {
			chain.doFilter(request, response);
			return;
		}
		boolean added = false;
		try {
			if (Context.isAuthenticated() && !Context.hasPrivilege(PrivilegeConstants.GET_CARE_SETTINGS) && writer()) {
				Context.addProxyPrivilege(PrivilegeConstants.GET_CARE_SETTINGS);
				added = true;
			}
		}
		catch (RuntimeException ignored) { }
		try {
			chain.doFilter(request, response);
		}
		finally {
			if (added) {
				try { Context.removeProxyPrivilege(PrivilegeConstants.GET_CARE_SETTINGS); }
				catch (RuntimeException ignored) { }
			}
		}
	}

	static boolean relevant(String method, String uri) {
		if (uri == null) { return false; }
		if (uri.contains("/ws/rest/v1/caresetting")) { return true; }
		boolean write = method != null && (method.equalsIgnoreCase("POST") || method.equalsIgnoreCase("PUT"));
		if (!write) { return false; }
		if (uri.contains("/ws/rest/v1/order")) { return true; }
		return uri.contains("/ws/fhir2/")
		        && (uri.contains("MedicationRequest") || uri.contains("ServiceRequest") || uri.contains("MedicationDispense"));
	}

	private static boolean writer() {
		if (!ModulePrivileges.matrixRole()) { return false; }
		return ModuleAccess.LABORATORY.allows(ModulePrivileges.current(), Access.WRITE)
		        || ModuleAccess.PHARMACY.allows(ModulePrivileges.current(), Access.WRITE);
	}
}
