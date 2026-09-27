/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reports;

import java.util.Collections;

import org.openmrs.module.liberiaemrreports.reporting.IndicatorSql;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.springframework.stereotype.Component;

/**
 * The EMR-Ops sheet. <b>Placeholder until RPT 8 (LE-334)</b>, which replaces
 * {@link #PLACEHOLDER_SQL} with the sheet's indicators (EMR-OPS-007, 008 and 015 first).
 * <p>
 * The placeholder proves the framework end to end on a running instance: registration under the
 * fixed UUIDs, the privilege check, location scope and the ETL hierarchy, the period binding, and
 * the CSV and Excel designs. Its one column counts encounters in the period, attributed by
 * encounter location or else visit location (ADR 0010 decision 5).
 */
@Component
public class EmrOpsReportManager extends LiberiaReportManager {
	
	static final String PLACEHOLDER_COLUMN = "PLACEHOLDER_ENCOUNTERS";
	
	static final String PLACEHOLDER_SQL = IndicatorSql
	        .select(Collections.singletonList(IndicatorSql.count(PLACEHOLDER_COLUMN, "e.encounter_id IS NOT NULL")),
	            "FROM encounter e\n" //
	                    + "LEFT JOIN visit v ON v.visit_id = e.visit_id\n" //
	                    + "WHERE e.voided = false\n" //
	                    + "  AND e.encounter_datetime BETWEEN :startDate AND :endDate\n" //
	                    + "  AND COALESCE(e.location_id, v.location_id) IN ${scopeLocations}");
	
	@Override
	public ReportSheet getSheet() {
		return ReportSheet.EMR_OPS;
	}
	
	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addDataSet(reportDefinition, INDICATORS, PLACEHOLDER_SQL);
	}
}
