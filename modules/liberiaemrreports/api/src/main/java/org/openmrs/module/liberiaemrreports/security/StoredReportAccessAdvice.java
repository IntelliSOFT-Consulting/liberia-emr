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

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.module.liberiaemrreports.reporting.EtlSqlDataSetDefinition;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.dataset.definition.DataSetDefinition;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.definition.service.ReportDefinitionService;
import org.springframework.aop.MethodBeforeAdvice;

/**
 * Guards stored output of this module's reports (ADR 0010 decision 6, the open question).
 * <p>
 * reportingrest's {@code downloadReport} returns a stored result through
 * {@code ReportService.loadRenderedOutput} without evaluating anything, so the data set evaluator's
 * check never runs. reporting 2.1.0's {@code ReportService} carries no {@code @Authorized} on any
 * method: that download was guarded by authentication alone, and any logged-in user holding a
 * request UUID could read a national report. This advice requires
 * {@value NationalReportPrivilege#PRIVILEGE} on every method that returns a stored result, for
 * requests of this module's reports only.
 */
public class StoredReportAccessAdvice implements MethodBeforeAdvice {
	
	/** The {@code ReportService} methods that hand back a stored result. */
	static final Set<String> GUARDED_METHODS = Collections
	        .unmodifiableSet(new HashSet<String>(Arrays.asList("loadRenderedOutput", "loadReportData", "loadReport")));
	
	@Override
	public void before(Method method, Object[] args, Object target) {
		if (!GUARDED_METHODS.contains(method.getName()) || args == null || args.length == 0
		        || !(args[0] instanceof ReportRequest)) {
			return;
		}
		if (Daemon.isDaemonThread() || !isOurs((ReportRequest) args[0])) {
			return;
		}
		NationalReportPrivilege.requireHeldBy(Context.getAuthenticatedUser(), "the current user");
	}
	
	/**
	 * A request is ours when its report is one of the module's sheets, <b>or</b> when its report runs
	 * any of this module's ETL data sets under another UUID. The UUID alone is not enough: a
	 * definition carrying the registered SQL can be saved under a new UUID and evaluated by a user
	 * with the privilege, and its stored output must stay behind the privilege too. If the stored
	 * definition cannot be inspected, the request is treated as ours (fail closed).
	 */
	static boolean isOurs(ReportRequest request) {
		Mapped<?> mapped = request.getReportDefinition();
		if (mapped == null || mapped.getParameterizable() == null) {
			return false;
		}
		String uuid = mapped.getParameterizable().getUuid();
		for (ReportSheet sheet : ReportSheet.values()) {
			if (sheet.getReportUuid().equals(uuid)) {
				return true;
			}
		}
		ReportDefinition definition;
		try {
			definition = definitionOf(mapped, uuid);
		}
		catch (RuntimeException e) {
			return true;
		}
		return definition != null && runsEtlDataSets(definition);
	}
	
	static boolean runsEtlDataSets(ReportDefinition definition) {
		if (definition.getDataSetDefinitions() == null) {
			return false;
		}
		for (Mapped<? extends DataSetDefinition> dataSet : definition.getDataSetDefinitions().values()) {
			if (dataSet != null && dataSet.getParameterizable() instanceof EtlSqlDataSetDefinition) {
				return true;
			}
		}
		return false;
	}
	
	private static ReportDefinition definitionOf(Mapped<?> mapped, String uuid) {
		if (mapped.getParameterizable() instanceof ReportDefinition
		        && ((ReportDefinition) mapped.getParameterizable()).getDataSetDefinitions() != null
		        && !((ReportDefinition) mapped.getParameterizable()).getDataSetDefinitions().isEmpty()) {
			return (ReportDefinition) mapped.getParameterizable();
		}
		if (uuid == null) {
			return null;
		}
		// Runs as the requesting user; if the lookup is refused, isOurs fails closed.
		return Context.getService(ReportDefinitionService.class).getDefinitionByUuid(uuid);
	}
}
