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

import static org.openmrs.module.liberiaemrreports.reporting.IndicatorSql.column;

import java.util.Arrays;
import java.util.List;

import org.openmrs.module.liberiaemrreports.reporting.IndicatorQuery;
import org.openmrs.module.liberiaemrreports.reporting.IndicatorSql;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.springframework.stereotype.Component;

/**
 * The EMR-Ops sheet: the Feasible-now rows EMR-OPS-007, 008 and 015
 * ({@code docs/reporting/feasibility/emr-ops.csv}; {@code qa/reporting/README.md} ambiguities 14 to
 * 16).
 * <p>
 * EMR-OPS-007 and 015 have a facility and a central definition in the matrix, so their SQL depends
 * on the instance role; EMR-OPS-008 is the same at both. Like every sheet, they read only the ETL
 * schema: the identity flags come from {@code mamba_fact_emr_ops_patient}, which reads the CPI
 * service's links at central.
 */
@Component
public class EmrOpsReportManager extends LiberiaReportManager {
	
	/** Repeated in this file's SQL. */
	private static final String COUNT_ALL = "COUNT(*)";

	static final String PATIENT = "${etl}.mamba_fact_emr_ops_patient";

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.EMR_OPS;
	}

	@Override
	protected List<String> getNotes() {
		return Arrays.asList(
		    "EMR-OPS-007: at a facility, records sharing name, birthdate and sex or an identifier (2 per pair); at central, persons the CPI service linked to more than one record at the same facility; probabilistic match band not captured (only exact National ID matches are linked)",
		    "EMR-OPS-008: encounters in the period, system types (Check In, Check Out, Attachment Upload, Order, Lab Results, Bed Assignment, Cancel ADT, Transfer Request) and voided encounters excluded",
		    "EMR-OPS-015: at a facility, patients with 2+ visits holding exactly one MOH Health Record Number and no voided one; at central, persons whose records all carry the same National ID or were linked on it; cross-facility matches outside the National ID not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addIndicators(reportDefinition, queries(getRole()));
	}

	static List<IndicatorQuery> queries(InstanceRole role) {
		return Arrays.asList(duplicateRecords(role), sameDayEntry(), consistentIdentifier(role));
	}

	/**
	 * EMR-OPS-007, over the stock of records registered by the period end.
	 * <ul>
	 * <li>facility: records flagged as probable duplicates, over records;</li>
	 * <li>central: (person, facility) groups of more than one linked record, over persons.</li>
	 * </ul>
	 */
	static IndicatorQuery duplicateRecords(InstanceRole role) {
		String code = "EMR-OPS-007";
		String numerator;
		String denominator;
		if (role == InstanceRole.CENTRAL) {
			numerator = "COUNT(DISTINCT CASE WHEN f.same_facility_link = 1"
			        + " THEN CONCAT(f.person_key, '|', COALESCE(f.facility_location_id, 0)) END)";
			denominator = "COUNT(DISTINCT f.person_key)";
		} else {
			numerator = "COALESCE(SUM(CASE WHEN f.is_probable_duplicate = 1 THEN 1 ELSE 0 END), 0)";
			denominator = COUNT_ALL;
		}
		String num = numerator;
		String den = denominator;
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "f.facility_location_id",
		    Arrays.asList(num + " AS " + column(code, "NUM"), den + " AS " + column(code, "DEN"),
		        IndicatorSql.percent(column(code, "PCT"), num, den)),
		    "FROM " + PATIENT + " f\n" //
		            + "WHERE f.date_registered <= :endDate\n" //
		            + "  AND " + g.inScope("f")),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	/**
	 * EMR-OPS-008: clinical encounters in the period entered on the day of service. Voided encounters
	 * are not in {@code mamba_dim_encounter_location}; system types are flagged by the ETL.
	 */
	static IndicatorQuery sameDayEntry() {
		String code = "EMR-OPS-008";
		String sameDay = "CAST(e.date_created AS DATE) = CAST(e.encounter_datetime AS DATE)";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "h.facility_location_id",
		    Arrays.asList(IndicatorSql.count(column(code, "NUM"), sameDay), IndicatorSql.count(column(code, "DEN"), "1 = 1"),
		        IndicatorSql.percent(column(code, "PCT"), "SUM(CASE WHEN " + sameDay + " THEN 1 ELSE 0 END)", COUNT_ALL)),
		    "FROM ${etl}.mamba_dim_encounter e\n" //
		            + "INNER JOIN ${etl}.mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id\n" //
		            + "INNER JOIN ${etl}.mamba_dim_emr_ops_encounter_type t ON t.encounter_type_id = e.encounter_type\n" //
		            + "LEFT JOIN ${etl}.mamba_dim_location_hierarchy h ON h.location_id = el.location_id\n" //
		            + "WHERE t.is_system_type = 0\n" //
		            + "  AND " + Sql.inPeriod("e.encounter_datetime") + "\n" //
		            + "  AND " + g.inScope("el")),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	/**
	 * EMR-OPS-015: persons with two or more live visits started in the period, in scope, and those of
	 * them whose identifier is consistent: the MOH Health Record Number at a facility, the National ID
	 * across linked records at central. A visit counts even if its only encounter is voided.
	 */
	static IndicatorQuery consistentIdentifier(InstanceRole role) {
		String code = "EMR-OPS-015";
		String consistent = role == InstanceRole.CENTRAL ? "MAX(pt.person_national_id_consistent)"
		        : "MIN(pt.hrn_consistent)";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "x.facility_location_id",
		    Arrays.asList(IndicatorSql.count(column(code, "NUM"), "x.consistent = 1"),
		        IndicatorSql.count(column(code, "DEN"), "1 = 1"), IndicatorSql.percent(column(code, "PCT"),
		            "SUM(CASE WHEN x.consistent = 1 THEN 1 ELSE 0 END)", COUNT_ALL)),
		    "FROM (SELECT " + g.keyColumn("v.facility_location_id") + "pc.person_key, " + consistent + " AS consistent\n" //
		            + "      FROM ${etl}.mamba_fact_emr_ops_visit v" + Sql.joinPersonKey("v", "pc") + "\n" //
		            + "      INNER JOIN " + PATIENT + " pt ON pt.client_id = v.client_id\n" //
		            + "      WHERE " + Sql.inPeriod("v.date_started") + "\n" //
		            + "        AND " + g.inScope("v") + "\n" //
		            + "      GROUP BY " + g.groupKey("v.facility_location_id") + "pc.person_key\n" //
		            + "      HAVING COUNT(DISTINCT v.visit_id) >= 2) x"),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}
}
