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

import java.util.HashMap;
import java.util.Map;

import org.openmrs.api.context.Context;
import org.openmrs.module.reporting.dataset.definition.DataSetDefinition;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.springframework.stereotype.Component;

/**
 * The only ETL SQL that {@link EtlSqlDataSetEvaluator} will run: the data sets this module's
 * {@link LiberiaReportManager}s build, by name and exact SQL.
 * <p>
 * An {@link EtlSqlDataSetDefinition} carries its SQL as a plain property, and reportingrest will
 * evaluate a definition that a caller serialises and POSTs (its {@code reportdata} resource). A
 * caller could therefore submit {@code SELECT patient_id AS MAL_004_NUM ...} under an innocent
 * column name, and no column-name check can tell it from an indicator. So the evaluator does not
 * trust the definition it is handed, nor the copy persisted in the database (which anyone with
 * reporting's Manage Report Definitions could overwrite): it rebuilds the reports from this
 * module's code and refuses any data set whose name and SQL are not one of theirs, character for
 * character.
 * <p>
 * The expected set is rebuilt on every call, not cached. Building a definition only concatenates
 * strings, and a rebuild always matches what {@link ReportRegistrar} saves for the current instance
 * role, including the central-only {@link LiberiaReportManager#BY_FACILITY} data set.
 */
@Component("liberiaemrreportsRegisteredEtlDataSets")
public class RegisteredEtlDataSets {

	/**
	 * @throws UnregisteredDataSetException unless {@code definition} is, by name and exact SQL, a data
	 *             set of a report this module registers
	 */
	public void require(EtlSqlDataSetDefinition definition) {
		String expected = expectedSql().get(definition.getName());
		if (expected == null || !expected.equals(definition.getSqlQuery())) {
			throw new UnregisteredDataSetException("Data set '" + definition.getName()
			        + "' is not one this module registers; only the LiberiaEMR indicator reports' own ETL data sets"
			        + " may be evaluated");
		}
	}

	/**
	 * @return the SQL of every ETL data set the registered managers build, by data set name
	 */
	Map<String, String> expectedSql() {
		Map<String, String> expected = new HashMap<String, String>();
		for (LiberiaReportManager manager : Context.getRegisteredComponents(LiberiaReportManager.class)) {
			ReportDefinition reportDefinition = manager.constructReportDefinition();
			for (Mapped<? extends DataSetDefinition> mapped : reportDefinition.getDataSetDefinitions().values()) {
				DataSetDefinition dsd = mapped.getParameterizable();
				if (dsd instanceof EtlSqlDataSetDefinition) {
					expected.put(dsd.getName(), ((EtlSqlDataSetDefinition) dsd).getSqlQuery());
				}
			}
		}
		return expected;
	}
}
