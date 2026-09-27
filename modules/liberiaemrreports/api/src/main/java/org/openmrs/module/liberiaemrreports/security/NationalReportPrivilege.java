/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.security;

import org.openmrs.User;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.service.ReportService;
import org.openmrs.module.reporting.report.service.ReportServiceImpl;

/**
 * Enforces {@value #PRIVILEGE} on every evaluation of this module's data sets (ADR 0010 decision 6,
 * {@code docs/reporting/README.md} §3.4). reportingrest checks nothing LiberiaEMR-specific, so the
 * check lives where every evaluating path ends: {@code reportRequest}, {@code reportDataSet} and
 * {@code reportdata}.
 * <p>
 * A queued {@code reportRequest} is evaluated later on reporting's daemon thread, where
 * {@link Context#hasPrivilege} is always true. So when the evaluation belongs to a report request,
 * the user who <em>requested</em> it must hold the privilege; on a user's own thread that user must
 * hold it as well. A daemon evaluation that belongs to no request is refused.
 */
public final class NationalReportPrivilege {
	
	/** Defined in privileges-national.csv; held by National Reporting Officer. */
	public static final String PRIVILEGE = "Export National Report";
	
	private NationalReportPrivilege() {
	}
	
	/**
	 * @param context the evaluation context of the data set being evaluated
	 * @throws APIAuthenticationException if the caller, or the report's requester, lacks the privilege
	 */
	public static void check(EvaluationContext context) {
		boolean daemon = Daemon.isDaemonThread();
		if (!daemon) {
			requireHeldBy(Context.getAuthenticatedUser(), "the current user");
		}
		
		Object requestUuid = context == null ? null : context.getContextValues().get(ReportServiceImpl.REPORT_REQUEST_UUID);
		if (requestUuid != null) {
			ReportRequest request = Context.getService(ReportService.class).getReportRequestByUuid(requestUuid.toString());
			requireHeldBy(request == null ? null : request.getRequestedBy(), "the user who requested this report");
		} else if (daemon) {
			throw new APIAuthenticationException(
			        "A LiberiaEMR indicator report can only be evaluated for a user or a report request");
		}
	}
	
	/**
	 * @param user the user to check; null always fails
	 * @param who how to name the user in the message
	 */
	static void requireHeldBy(User user, String who) {
		if (user == null || !user.hasPrivilege(PRIVILEGE)) {
			throw new APIAuthenticationException("Privilege required: " + PRIVILEGE + " (not held by " + who + ")");
		}
	}
}
