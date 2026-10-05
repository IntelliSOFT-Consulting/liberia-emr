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
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.springframework.stereotype.Component;

/**
 * The Malaria sheet: the Feasible-now rows MAL-002, MAL-003 and MAL-004, read as
 * {@code qa/reporting/README.md} fixes them (ambiguities 1, 6 and 8). The ANC rows read RPT 6's
 * {@code mamba_fact_rmncah_anc_visit} (its ANC/IPTp contract), not a table of their own.
 */
@Component
public class MalariaReportManager extends LiberiaReportManager {
	
	/** Repeated in this file's SQL. */
	private static final String RESULTED_AT = "r.resulted_at";

	/** Episode window for confirmed malaria (ambiguity 6). */
	static final int MALARIA_EPISODE_DAYS = 28;

	static final String ANC = "${etl}.mamba_fact_rmncah_anc_visit";

	static final String LAB = "${etl}.mamba_fact_malaria_lab_result";

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.MALARIA;
	}

	@Override
	protected List<String> getNotes() {
		return Arrays.asList(
		    "MAL-002: the numerator (women given a 3rd or later IPTp dose) is not a subset of the denominator (women at a first ANC contact), as the matrix defines them; both are reported",
		    "MAL-003: pending the MOH's decision on the sheet's conflicting texts, women given a 2nd or later IPTp dose at a 3rd-trimester ANC contact; sex not meaningful (all are women)",
		    "MAL-004: numerator only (the population at risk is not in the EMR); one case per person per 28 days; point-of-care RDTs without a lab order not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addIndicators(reportDefinition, queries());
	}

	static List<IndicatorQuery> queries() {
		return Arrays.asList(iptp3(), iptp2ThirdTrimester(), confirmedCases());
	}

	/**
	 * MAL-002: women with a 3rd or later IPTp dose at an ANC contact in the period, over women with a
	 * first ANC contact in the period. Each woman counts once in each part.
	 */
	static IndicatorQuery iptp3() {
		return ancRatio("MAL-002", "f.iptp_dose_number >= 3", "f.is_first_anc_contact = 1");
	}

	/**
	 * MAL-003: women with a 3rd-trimester ANC contact in the period, and those of them given a 2nd or
	 * later IPTp dose at such a contact.
	 */
	static IndicatorQuery iptp2ThirdTrimester() {
		return ancRatio("MAL-003", "f.is_third_trimester = 1 AND f.iptp_dose_number >= 2", "f.is_third_trimester = 1");
	}

	private static IndicatorQuery ancRatio(String code, String numerator, String denominator) {
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "f.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(column(code, "NUM"), "f.person_key", numerator),
		        IndicatorSql.countDistinct(column(code, "DEN"), "f.person_key", denominator),
		        IndicatorSql.percent(column(code, "PCT"), "COUNT(DISTINCT CASE WHEN " + numerator + " THEN f.person_key END)",
		            "COUNT(DISTINCT CASE WHEN " + denominator + " THEN f.person_key END)")),
		    "FROM " + ANC + " f\n" //
		            + "WHERE " + Sql.inPeriod("f.encounter_datetime") + "\n" //
		            + "  AND " + g.inScope("f")),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	/**
	 * MAL-004, numerator only: confirmed cases, a positive RDT or smear result in the period that starts
	 * an episode. A result starts one unless the same person had a positive result, in scope, at most
	 * {@value #MALARIA_EPISODE_DAYS} days before it, looking back across the period start.
	 */
	static IndicatorQuery confirmedCases() {
		String num = column("MAL-004", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "r.facility_location_id",
		    Arrays.asList(IndicatorSql.count(num, "1 = 1")),
		    "FROM " + LAB + " r" + Sql.joinPersonKey("r", "pr") + "\n" //
		            + "WHERE r.is_malaria_positive = 1\n" //
		            + "  AND " + Sql.inPeriod(RESULTED_AT) + "\n" //
		            + "  AND " + g.inScope("r") + "\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM " + LAB + " q" + Sql.joinPersonKey("q", "pq") + "\n" //
		            + "                  WHERE pq.person_key = pr.person_key\n" //
		            + "                    AND q.is_malaria_positive = 1\n" //
		            + "                    AND " + g.inSameScope("q", "r") + "\n" //
		            + "                    AND " + Sql.before("q.resulted_at", RESULTED_AT,
		                "(q.order_id < r.order_id OR (q.order_id = r.order_id AND q.result_obs_id < r.result_obs_id))") + "\n" //
		            + "                    AND " + Sql.withinDaysBefore("q.resulted_at", RESULTED_AT, MALARIA_EPISODE_DAYS)
		            + ")"),
		    num);
	}
}
