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

import org.openmrs.module.reporting.dataset.definition.BaseDataSetDefinition;
import org.openmrs.module.reporting.definition.configuration.ConfigurationProperty;

/**
 * An aggregate SQL data set over the local ETL schema, evaluated by {@link EtlSqlDataSetEvaluator}.
 * <p>
 * The SQL may use these, and nothing else, to reach the run's context:
 * <ul>
 * <li>{@code ${etl}}: the ETL schema, e.g. {@code FROM ${etl}.mamba_fact_malaria_case f};</li>
 * <li>{@code ${scopeLocations}}: the in-scope location ids, e.g. {@code WHERE f.location_id IN
 * ${scopeLocations}};</li>
 * <li>{@code :startDate} and {@code :endDate}: the period, already widened to whole days.</li>
 * </ul>
 * It must never hold a UUID literal (ADR 0010 decision 7): coded logic belongs in the ETL's derived
 * SQL, and reports read named fact columns.
 */
// java:S2160 - a definition's identity is its uuid (BaseOpenmrsObject.equals), which is how the reporting
// module stores, caches and compares definitions; equality on the SQL would change that.
@SuppressWarnings("java:S2160")
public class EtlSqlDataSetDefinition extends BaseDataSetDefinition {
	
	private static final long serialVersionUID = 1L;
	
	@ConfigurationProperty
	private String sqlQuery;
	
	public EtlSqlDataSetDefinition() {
		super();
	}
	
	public EtlSqlDataSetDefinition(String name, String sqlQuery) {
		super(name);
		this.sqlQuery = sqlQuery;
		addParameters(ReportParameters.all());
	}
	
	public String getSqlQuery() {
		return sqlQuery;
	}
	
	public void setSqlQuery(String sqlQuery) {
		this.sqlQuery = sqlQuery;
	}
}
