/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.uuid;

/**
 * The MOH workbook sheets, one report each ({@code docs/reporting/README.md} §3.1). The key is the
 * {@code <sheet>} part of {@code var.report.<sheet>.uuid}.
 */
public enum ReportSheet {
	
	RMNCAH("rmncah", "MOH RMNCAH Indicators"),
	NUTRITION("nutrition", "MOH Nutrition Indicators"),
	MALARIA("malaria", "MOH Malaria Indicators"),
	NCD("ncd", "MOH NCD Indicators"),
	EMR_OPS("emr-ops", "MOH EMR Operational Indicators");
	
	private final String key;
	
	private final String reportName;
	
	ReportSheet(String key, String reportName) {
		this.key = key;
		this.reportName = reportName;
	}
	
	public String getKey() {
		return key;
	}
	
	public String getReportName() {
		return reportName;
	}
	
	/** @return this sheet's report definition UUID */
	public String getReportUuid() {
		return ReportUuids.get("var.report." + key + ".uuid");
	}
	
	/** @return the UUID of this sheet's CSV design */
	public String getCsvDesignUuid() {
		return ReportUuids.get("var.reportdesign." + key + "-csv.uuid");
	}
	
	/** @return the UUID of this sheet's Excel design */
	public String getExcelDesignUuid() {
		return ReportUuids.get("var.reportdesign." + key + "-xlsx.uuid");
	}
}
