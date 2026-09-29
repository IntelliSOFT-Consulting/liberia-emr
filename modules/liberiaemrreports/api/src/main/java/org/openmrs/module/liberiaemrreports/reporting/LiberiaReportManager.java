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

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;
import org.openmrs.module.reporting.report.ReportDesign;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.manager.BaseReportManager;
import org.openmrs.module.reporting.report.manager.ReportManagerUtil;

/**
 * One MOH workbook sheet as a report ({@code docs/reporting/README.md} §3.1).
 * <p>
 * A subclass names its {@link ReportSheet} and adds its data sets; everything a sheet shares is
 * fixed here: the report and design UUIDs (from content variables, never literals), the name, the
 * three standard parameters and the CSV and Excel designs. Annotate the subclass with
 * {@code @Component} and {@link ReportRegistrar} saves it on every start.
 */
public abstract class LiberiaReportManager extends BaseReportManager {
	
	/** The key of every sheet's main data set. */
	public static final String INDICATORS = "indicators";
	
	/** The key of the row-per-facility breakdown, which central adds. */
	public static final String BY_FACILITY = "by_facility";
	
	/** @return the sheet this report produces */
	public abstract ReportSheet getSheet();
	
	/**
	 * Adds this sheet's data sets, normally {@link #addDataSet} with {@link #INDICATORS}.
	 */
	protected abstract void addDataSets(ReportDefinition reportDefinition);
	
	@Override
	public final String getUuid() {
		return getSheet().getReportUuid();
	}
	
	@Override
	public String getName() {
		return getSheet().getReportName();
	}
	
	/**
	 * The report UI shows this field: a one-line summary, then the sheet's {@link #getNotes()}.
	 */
	@Override
	public String getDescription() {
		StringBuilder sb = new StringBuilder(getSheet().getReportName())
		        .append(": aggregate indicators from this instance's ETL schema.");
		for (String note : getNotes()) {
			sb.append('\n').append(note);
		}
		return sb.toString();
	}
	
	/**
	 * Notes shown with the report, one line each: every disaggregation the workbook asks for that
	 * LiberiaEMR does not capture (e.g. {@code MAL-004: age band not captured}), and every indicator
	 * returned as numerator only.
	 */
	protected List<String> getNotes() {
		return Collections.emptyList();
	}
	
	/**
	 * Not used to decide re-saving: {@link ReportRegistrar} re-saves on every start, so a change in SQL
	 * or in the ETL schema name takes effect on restart (ADR 0010 decision 6).
	 */
	@Override
	public String getVersion() {
		return "1";
	}
	
	@Override
	public List<Parameter> getParameters() {
		return ReportParameters.all();
	}
	
	@Override
	public final ReportDefinition constructReportDefinition() {
		ReportDefinition rd = new ReportDefinition();
		rd.setUuid(getUuid());
		rd.setName(getName());
		rd.setDescription(getDescription());
		rd.setParameters(getParameters());
		addDataSets(rd);
		return rd;
	}
	
	@Override
	public List<ReportDesign> constructReportDesigns(ReportDefinition reportDefinition) {
		return Arrays.asList(ReportManagerUtil.createCsvReportDesign(getSheet().getCsvDesignUuid(), reportDefinition),
		    ReportManagerUtil.createExcelDesign(getSheet().getExcelDesignUuid(), reportDefinition));
	}
	
	/**
	 * Adds an aggregate ETL SQL data set, with the report's parameters passed straight through.
	 *
	 * @param key {@link #INDICATORS} or {@link #BY_FACILITY}
	 * @param sql see {@link EtlSqlDataSetDefinition} for the tokens it may use
	 */
	protected void addDataSet(ReportDefinition reportDefinition, String key, String sql) {
		EtlSqlDataSetDefinition dsd = new EtlSqlDataSetDefinition(getSheet().getKey() + "-" + key, sql);
		reportDefinition.addDataSetDefinition(key, Mapped.mapStraightThrough(dsd));
	}
	
	/**
	 * Adds the row-per-facility breakdown under {@link #BY_FACILITY}, on a central instance only
	 * ({@code docs/reporting/README.md} §3.3). The role is fixed for the life of the process and
	 * reports are re-saved on every start, so a facility never carries this data set.
	 *
	 * @param sql grouped by facility; name the facility column {@code facility_name}, never
	 *            {@code name}, which the aggregate-only check refuses
	 */
	protected void addByFacilityDataSet(ReportDefinition reportDefinition, String sql) {
		if (getRole() == InstanceRole.CENTRAL) {
			addDataSet(reportDefinition, BY_FACILITY, sql);
		}
	}

	/**
	 * Adds a sheet's {@link #INDICATORS} data set and, at central, its {@link #BY_FACILITY} one, from
	 * the same queries ({@link IndicatorQuery#indicatorsSql}, {@link IndicatorQuery#byFacilitySql}).
	 */
	protected void addIndicators(ReportDefinition reportDefinition, List<IndicatorQuery> queries) {
		addDataSet(reportDefinition, INDICATORS, IndicatorQuery.indicatorsSql(queries));
		if (getRole() == InstanceRole.CENTRAL) {
			addDataSet(reportDefinition, BY_FACILITY, IndicatorQuery.byFacilitySql(queries));
		}
	}

	/**
	 * @return this instance's role, for an indicator whose facility and central definitions differ
	 *         (EMR-Ops). Fixed for the life of the process, and definitions are rebuilt on every start.
	 */
	protected InstanceRole getRole() {
		return Context.getRegisteredComponent("liberiaemrreports.locationScopeResolver", LocationScopeResolver.class)
		        .getRole();
	}
}
