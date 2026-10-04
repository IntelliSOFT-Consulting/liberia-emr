/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.context;

import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.Location;
import org.openmrs.module.liberiaemrreports.etl.EtlSchema;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.querybuilder.SqlQueryBuilder;
import org.openmrs.module.reporting.evaluation.service.EvaluationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * What the report UI needs to know about this instance and cannot read itself: a National Reporting
 * Officer holds neither Get Global Properties nor access to the environment. Served by the omod at
 * {@code GET /ws/rest/v1/liberiaemrreports/context}.
 */
@Component("liberiaemrreportsReportingContextService")
// java:S2143 - JDBC returns java.util.Date (a Timestamp) for the ETL schedule's DATETIME columns.
@SuppressWarnings("java:S2143")
public class ReportingContextService {
	
	private static final Log log = LogFactory.getLog(ReportingContextService.class);
	
	/** The table core 3.0.0 writes one row to per scheduled ETL run ({@code sp_mamba_etl_schedule}). */
	static final String SCHEDULE_TABLE = "_mamba_etl_schedule";
	
	/** What core 3.0.0's {@code sp_mamba_etl_un_stuck_scheduler} writes over a stuck run. */
	static final String STUCK_MESSAGE = "Stuck schedule updated";
	
	/** What the same procedure writes over a run that ended in ERROR. */
	static final String ERROR_MESSAGE = "Error schedule updated";
	
	private static final String STATUS_ERROR = "ERROR";
	
	private LocationScopeResolver locationScopeResolver;
	
	private EvaluationService evaluationService;
	
	/**
	 * @return {@code instanceRole} ({@code facility} or {@code central}, after the fail-closed check),
	 *         {@code facilityLocation} ({@code {uuid, display}}, null at central or when the facility
	 *         cannot resolve its own location), {@code etlSchema}, and {@code etlLastRun} (see
	 *         {@link #getEtlLastRun()})
	 */
	public Map<String, Object> getContext() {
		Map<String, Object> context = new LinkedHashMap<String, Object>();
		InstanceRole role = locationScopeResolver.getRole();
		context.put("instanceRole", role.name().toLowerCase(Locale.ROOT));
		
		Map<String, Object> facility = null;
		if (role == InstanceRole.FACILITY) {
			Location root = locationScopeResolver.getFacilityRoot();
			if (root != null) {
				facility = new LinkedHashMap<String, Object>();
				facility.put("uuid", root.getUuid());
				facility.put("display", root.getName());
			}
		}
		context.put("facilityLocation", facility);
		context.put("etlSchema", EtlSchema.getEtlDatabase());
		Map<String, Object> lastRun = getEtlLastRun();
		// null, not {}, in the response: the UI and its tests read "no run yet" as null.
		context.put("etlLastRun", lastRun.isEmpty() ? null : lastRun);
		return context;
	}
	
	/**
	 * The latest row of the ETL schedule, or an empty map when the ETL has never run here (or its schema
	 * is absent). {@code status} is one of:
	 * <ul>
	 * <li>{@code RUNNING}: started and not finished. A run that crashed also reads this way until the
	 * next scheduled run marks it stuck;</li>
	 * <li>{@code SUCCESS}: finished normally;</li>
	 * <li>{@code INTERRUPTED}: core found it stuck and closed it;</li>
	 * <li>{@code ERROR}: ended in error. Core 3.0.0 never writes ERROR itself, so this is
	 * defensive.</li>
	 * </ul>
	 * Core rewrites a stuck or failed row's times to the previous successful start, so
	 * {@code startedAt}/{@code completedAt} of a non-SUCCESS run are not that run's own. Error details
	 * land in {@code _mamba_etl_error_log}.
	 */
	public Map<String, Object> getEtlLastRun() {
		SqlQueryBuilder query = new SqlQueryBuilder(EtlSchema.qualify(
		    "SELECT start_time, end_time, transaction_status," + " completion_status, success_or_error_message FROM "
		            + EtlSchema.TOKEN + "." + SCHEDULE_TABLE + " ORDER BY id DESC LIMIT 1"));
		List<Object[]> rows;
		try {
			rows = evaluationService.evaluateToList(query, new EvaluationContext());
		}
		catch (RuntimeException e) {
			// Before the ETL's first deploy the table does not exist, which is expected. Anything else
			// (a missing grant on the ETL schema, a renamed schema) would otherwise look the same to
			// the UI as "never run", so it is logged where operators will see it.
			log.warn("Could not read the ETL schedule from " + SCHEDULE_TABLE + "; reporting no last run: "
			        + e.getMessage());
			log.debug("ETL schedule read failure", e);
			return Collections.emptyMap();
		}
		if (rows.isEmpty()) {
			return Collections.emptyMap();
		}
		Object[] row = rows.get(0);
		Map<String, Object> run = new LinkedHashMap<String, Object>();
		run.put("startedAt", iso(row[0]));
		run.put("completedAt", iso(row[1]));
		run.put("status", status(str(row[2]), str(row[3]), str(row[4])));
		return run;
	}
	
	@Autowired
	public void setLocationScopeResolver(LocationScopeResolver locationScopeResolver) {
		this.locationScopeResolver = locationScopeResolver;
	}
	
	@Autowired
	public void setEvaluationService(EvaluationService evaluationService) {
		this.evaluationService = evaluationService;
	}
	
	static String status(String transactionStatus, String completionStatus, String message) {
		if (STATUS_ERROR.equals(completionStatus) || ERROR_MESSAGE.equals(message)) {
			return STATUS_ERROR;
		}
		if (STUCK_MESSAGE.equals(message)) {
			return "INTERRUPTED";
		}
		if ("COMPLETED".equals(transactionStatus) && "SUCCESS".equals(completionStatus)) {
			// Core writes no message on a genuine success; any other message marks a run core
			// relabelled, so it must not be reported as a success.
			return message == null ? "SUCCESS" : STATUS_ERROR;
		}
		return "RUNNING";
	}
	
	private static String str(Object o) {
		return o == null ? null : o.toString();
	}
	
	private static String iso(Object o) {
		if (!(o instanceof Date)) {
			return o == null ? null : o.toString();
		}
		return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ").format((Date) o);
	}
}
