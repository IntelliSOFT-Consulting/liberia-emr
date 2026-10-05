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
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.openmrs.Location;
import org.openmrs.annotation.Handler;
import org.openmrs.module.liberiaemrreports.etl.EtlSchema;
import org.openmrs.module.liberiaemrreports.scope.LocationScope;
import org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver;
import org.openmrs.module.liberiaemrreports.security.NationalReportPrivilege;
import org.openmrs.module.reporting.common.DateUtil;
import org.openmrs.module.reporting.common.ObjectUtil;
import org.openmrs.module.reporting.dataset.DataSet;
import org.openmrs.module.reporting.dataset.DataSetColumn;
import org.openmrs.module.reporting.dataset.DataSetRow;
import org.openmrs.module.reporting.dataset.SimpleDataSet;
import org.openmrs.module.reporting.dataset.definition.DataSetDefinition;
import org.openmrs.module.reporting.dataset.definition.evaluator.DataSetEvaluator;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.EvaluationException;
import org.openmrs.module.reporting.evaluation.querybuilder.SqlQueryBuilder;
import org.openmrs.module.reporting.evaluation.service.EvaluationService;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Evaluates an {@link EtlSqlDataSetDefinition}. In order:
 * <ol>
 * <li>requires {@value NationalReportPrivilege#PRIVILEGE} ({@link NationalReportPrivilege});</li>
 * <li>refuses any definition this module did not build, by name and exact SQL
 * ({@link RegisteredEtlDataSets}): an ad-hoc or altered definition never reaches the database;</li>
 * <li>resolves the location scope for this instance's role, failing on an out-of-scope
 * location;</li>
 * <li>expands {@code ${scopeLocations}} and {@code ${etl}} and binds the period and scope;</li>
 * <li>refuses a result whose columns identify people or records (aggregates only). This is a
 * guard against a mistake in this module's own SQL, not against a hostile caller: an alias can
 * hide anything, which is why the registration check comes first;</li>
 * <li>runs the query read-only through reporting's {@link EvaluationService}.</li>
 * </ol>
 * The data set definition's own parameters are ignored beyond the three standard ones: nothing a
 * caller passes reaches the SQL except through these bindings.
 */
@Handler(supports = { EtlSqlDataSetDefinition.class })
// java.util.Date, not java.time: the reporting module passes the period as Date and expects Date
// cells back. SonarQube's java:S2143 is excluded for this file in the root pom.
public class EtlSqlDataSetEvaluator implements DataSetEvaluator {
	
	/**
	 * Column names that would make a data set patient- or record-level. Compared case-insensitively.
	 */
	static final Set<String> NON_AGGREGATE_COLUMNS = Collections.unmodifiableSet(new HashSet<String>(
	        Arrays.asList("patient_id", "person_id", "client_id", "encounter_id", "visit_id", "obs_id", "order_id", "uuid",
	            "identifier", "given_name", "middle_name", "family_name", "name", "birthdate", "phone_number", "address")));
	
	private EvaluationService evaluationService;
	
	private LocationScopeResolver locationScopeResolver;
	
	private RegisteredEtlDataSets registeredEtlDataSets;
	
	@Override
	public DataSet evaluate(DataSetDefinition dataSetDefinition, EvaluationContext context) throws EvaluationException {
		context = ObjectUtil.nvl(context, new EvaluationContext());
		EtlSqlDataSetDefinition definition = (EtlSqlDataSetDefinition) dataSetDefinition;
		
		NationalReportPrivilege.check(context);
		registeredEtlDataSets.require(definition);
		
		Date startDate = (Date) context.getParameterValue(ReportParameters.START_DATE);
		Date endDate = (Date) context.getParameterValue(ReportParameters.END_DATE);
		if (startDate == null || endDate == null) {
			throw new EvaluationException(
			        ReportParameters.START_DATE + " and " + ReportParameters.END_DATE + " are required");
		}
		LocationScope scope = locationScopeResolver.resolve((Location) context.getParameterValue(ReportParameters.LOCATION));
		
		Map<String, Object> bindings = new LinkedHashMap<String, Object>();
		bindings.put(ReportParameters.START_DATE, DateUtil.getStartOfDay(startDate));
		bindings.put(ReportParameters.END_DATE, DateUtil.getEndOfDay(endDate));
		bindings.putAll(scope.getParameterValues());
		
		String sql = EtlSchema.qualify(LocationScope.expand(definition.getSqlQuery()));
		SqlQueryBuilder query = new SqlQueryBuilder(sql, bindings);
		
		List<DataSetColumn> columns;
		List<Object[]> rows;
		try {
			columns = evaluationService.getColumns(query);
			requireAggregate(columns);
			rows = evaluationService.evaluateToList(query, context);
		}
		catch (IllegalArgumentException e) {
			// reporting wraps every SQL failure this way; the usual cause is an ETL table that the
			// ETL module has not built yet on this instance.
			throw new EvaluationException(
			        "data set '" + definition.getName() + "' (" + scope + "): the query failed; check that the ETL schema "
			                + EtlSchema.getEtlDatabase() + " has been built and holds the tables it reads",
			        e);
		}
		
		SimpleDataSet dataSet = new SimpleDataSet(definition, context);
		for (Object[] row : rows) {
			DataSetRow dataSetRow = new DataSetRow();
			for (int i = 0; i < columns.size(); i++) {
				dataSetRow.addColumnValue(columns.get(i), requirePlainValue(columns.get(i), row[i]));
			}
			dataSet.addRow(dataSetRow);
		}
		return dataSet;
	}
	
	static void requireAggregate(List<DataSetColumn> columns) {
		for (DataSetColumn column : columns) {
			if (NON_AGGREGATE_COLUMNS.contains(column.getName().toLowerCase(Locale.ROOT))) {
				throw new IllegalStateException("Indicator reports are aggregate only; column '" + column.getName()
				        + "' identifies a person or record");
			}
		}
	}
	
	/**
	 * A cell is a number, text, a date or null: never a Cohort or IdSet, which reportingrest serialises
	 * with their member ids.
	 */
	static Object requirePlainValue(DataSetColumn column, Object value) {
		if (value == null || value instanceof Number || value instanceof String || value instanceof Date
		        || value instanceof Boolean) {
			return value;
		}
		throw new IllegalStateException("Column '" + column.getName() + "' returned a " + value.getClass().getName()
		        + "; indicator data sets return plain values only");
	}
	
	@Autowired
	public void setEvaluationService(EvaluationService evaluationService) {
		this.evaluationService = evaluationService;
	}
	
	@Autowired
	public void setLocationScopeResolver(LocationScopeResolver locationScopeResolver) {
		this.locationScopeResolver = locationScopeResolver;
	}
	
	@Autowired
	public void setRegisteredEtlDataSets(RegisteredEtlDataSets registeredEtlDataSets) {
		this.registeredEtlDataSets = registeredEtlDataSets;
	}
}
