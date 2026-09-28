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

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.module.liberiaemrreports.reporting.EtlSqlDataSetDefinition;
import org.openmrs.module.reporting.dataset.definition.SqlDataSetDefinition;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.definition.ReportDefinition;

/**
 * The stored-output guard must not trust the report UUID alone: a definition that runs this module's
 * ETL data sets under another UUID is still ours.
 */
public class StoredReportAccessAdviceTest extends BaseModuleContextSensitiveTest {

	private static ReportRequest requestFor(ReportDefinition definition) {
		ReportRequest request = new ReportRequest();
		request.setReportDefinition(Mapped.mapStraightThrough(definition));
		return request;
	}

	@Test
	public void shouldTreatAReportRunningOurEtlDataSetUnderAnotherUuidAsOurs() {
		ReportDefinition renamed = new ReportDefinition();
		renamed.addDataSetDefinition("indicators",
		    Mapped.mapStraightThrough(new EtlSqlDataSetDefinition("emr-ops-indicators", "SELECT 1")));
		assertTrue(StoredReportAccessAdvice.isOurs(requestFor(renamed)));
	}

	@Test
	public void shouldLeaveOtherReportsAlone() {
		ReportDefinition other = new ReportDefinition();
		SqlDataSetDefinition sql = new SqlDataSetDefinition();
		sql.setSqlQuery("SELECT 1");
		other.addDataSetDefinition("rows", Mapped.mapStraightThrough(sql));
		assertFalse(StoredReportAccessAdvice.isOurs(requestFor(other)));
	}
}
