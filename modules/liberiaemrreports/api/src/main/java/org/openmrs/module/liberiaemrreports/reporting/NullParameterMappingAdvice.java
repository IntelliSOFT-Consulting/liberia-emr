/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reporting;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.ReportRequest;
import org.springframework.aop.MethodBeforeAdvice;

/**
 * Lets a report request leave the optional {@code location} parameter out, which is how a central
 * user asks for the national total ({@code docs/reporting/README.md} §3.2).
 * <p>
 * reportingrest 2.0.0's {@code ReportRequestResource} maps <em>every</em> parameter of the report,
 * so an omitted one arrives as {@code location -> null}. reporting 2.1.0 then fails the request in
 * {@code queueReport}: Hibernate's dirty check calls {@code Mapped.equals}, which calls
 * {@code equals} on each mapped value, and the null value throws a NullPointerException (HTTP 500).
 * A missing mapping and a null one mean the same to evaluation, so this advice drops the null
 * ones before the request is saved or queued, for this module's reports only.
 */
public class NullParameterMappingAdvice implements MethodBeforeAdvice {

	/** The {@code ReportService} methods that persist a request. */
	static final Set<String> SAVING_METHODS = Collections
	        .unmodifiableSet(new HashSet<String>(Arrays.asList("queueReport", "saveReportRequest")));

	@Override
	public void before(Method method, Object[] args, Object target) {
		if (SAVING_METHODS.contains(method.getName()) && args != null && args.length > 0
		        && args[0] instanceof ReportRequest) {
			dropNullMappings((ReportRequest) args[0]);
		}
	}

	static void dropNullMappings(ReportRequest request) {
		Mapped<?> mapped = request.getReportDefinition();
		if (mapped == null || mapped.getParameterizable() == null || mapped.getParameterMappings() == null
		        || !isOurs(mapped.getParameterizable().getUuid())) {
			return;
		}
		if (!mapped.getParameterMappings().containsValue(null)) {
			return;
		}
		Map<String, Object> mappings = new HashMap<String, Object>(mapped.getParameterMappings());
		mappings.values().removeIf(v -> v == null);
		mapped.setParameterMappings(mappings);
	}

	private static boolean isOurs(String uuid) {
		for (ReportSheet sheet : ReportSheet.values()) {
			if (sheet.getReportUuid().equals(uuid)) {
				return true;
			}
		}
		return false;
	}
}
