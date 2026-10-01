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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.openmrs.module.liberiaemrreports.reporting.Disaggregation;
import org.openmrs.module.liberiaemrreports.reporting.Grouping;
import org.openmrs.module.liberiaemrreports.reporting.IndicatorQuery;
import org.openmrs.module.liberiaemrreports.reporting.IndicatorSql;
import org.openmrs.module.liberiaemrreports.reporting.LiberiaReportManager;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.springframework.stereotype.Component;

/**
 * The NCD sheet: the Feasible-now rows NCD-002, 005, 007, 011 and 015, read as
 * {@code qa/reporting/README.md} fixes them (ambiguities 8 to 10). NCD-007 and NCD-011 are crude
 * rates: the WHO standard weights for age-standardisation are not yet fixed.
 */
@Component
public class NcdReportManager extends LiberiaReportManager {

	static final String DIAGNOSIS = "${etl}.mamba_fact_malaria_diagnosis";

	static final String LAB = "${etl}.mamba_fact_malaria_lab_result";

	/** NCD-005's cancer sites, by ICD-10 category. */
	static final List<Disaggregation> CANCER_SITES = Arrays.asList(
	    Disaggregation.of("_BREAST", "d.icd10_category = 'C50'"), Disaggregation.of("_CERVICAL", "d.icd10_category = 'C53'"),
	    Disaggregation.of("_PROSTATE", "d.icd10_category = 'C61'"));

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.NCD;
	}

	@Override
	protected List<String> getNotes() {
		return Arrays.asList(
		    "NCD-002: numerator only (years of exposure at ages 30-70 are not in the EMR); cancer site (breast, cervical, prostate) not captured, the cause of death is coded only as neoplasm/cancer; socio-economic status, education and urban/rural community type not captured",
		    "NCD-005: numerator only (the at-risk population is not in the EMR); first-ever diagnosis within the report's scope, per person and ICD-10 category; socio-economic status, education and urban/rural community type not captured",
		    "NCD-007: crude, not age-standardised (the WHO standard weights are not yet fixed); socio-economic status, education and urban/rural community type not captured",
		    "NCD-011: crude, not age-standardised (the WHO standard weights are not yet fixed); socio-economic status, education and urban/rural community type not captured",
		    "NCD-015: the numerator (a renal diagnosis) is not a subset of the denominator (a renal test), as the matrix defines them; both are reported; socio-economic status, education and urban/rural community type not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addIndicators(reportDefinition, queries());
	}

	static List<IndicatorQuery> queries() {
		return Arrays.asList(cancerDeaths(), newCancers(), raisedBloodPressure(), raisedCholesterol(), renalDisease());
	}

	/**
	 * NCD-002, numerator only: people who died in the period aged 30-69 with a coded cause of death
	 * of cancer, attributed to their last visit's location.
	 */
	static IndicatorQuery cancerDeaths() {
		String num = column("NCD-002", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "d.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(num, "pd.person_key", "1 = 1")),
		    "FROM ${etl}.mamba_fact_ncd_death d" + Sql.joinPersonKey("d", "pd") + "\n" //
		            + "WHERE d.cause_group = 'cancer'\n" //
		            + "  AND d.age_years_at_death BETWEEN 30 AND 69\n" //
		            + "  AND " + Sql.inPeriod("d.death_date") + "\n" //
		            + "  AND " + g.inScope("d")),
		    num);
	}

	/**
	 * NCD-005, numerator only: first-ever cancer diagnoses in the period, one per person and ICD-10
	 * category (the cancer site), judged within the report's scope (ambiguity 10), with the breast,
	 * cervical and prostate sites split out.
	 */
	static IndicatorQuery newCancers() {
		String num = column("NCD-005", "NUM");
		List<String> columns = new ArrayList<String>();
		columns.add(num);
		for (Disaggregation site : CANCER_SITES) {
			columns.add(num + site.getSuffix());
		}
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "d.facility_location_id",
		    IndicatorSql.disaggregated(num, "CONCAT(pc.person_key, '|', d.icd10_category)", "1 = 1", CANCER_SITES),
		    "FROM " + DIAGNOSIS + " d" + Sql.joinPersonKey("d", "pc") + "\n" //
		            + "WHERE d.icd10_group = 'cancer'\n" //
		            + "  AND " + Sql.inPeriod("d.encounter_datetime") + "\n" //
		            + "  AND " + g.inScope("d") + "\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM " + DIAGNOSIS + " e" + Sql.joinPersonKey("e", "pe") + "\n" //
		            + "                  WHERE pe.person_key = pc.person_key\n" //
		            + "                    AND e.icd10_category = d.icd10_category\n" //
		            + "                    AND " + g.inSameScope("e", "d") + "\n" //
		            + "                    AND " + Sql.before("e.encounter_datetime", "d.encounter_datetime",
		                "e.diagnosis_id < d.diagnosis_id") + ")"),
		    columns.toArray(new String[0]));
	}

	/**
	 * NCD-007: people aged 18+ with a blood-pressure reading in the period, and those whose latest
	 * reading in it is raised (SBP >= 140 or DBP >= 90). Crude.
	 */
	static IndicatorQuery raisedBloodPressure() {
		return latestPerAdult("NCD-007", "b.is_raised = 1", "${etl}.mamba_fact_ncd_blood_pressure", "1 = 1",
		    "encounter_datetime", "encounter_id");
	}

	/**
	 * NCD-011: people aged 18+ with a total cholesterol result in the period, and those whose latest
	 * result in it is 5.0 mmol/L or more. Crude.
	 */
	static IndicatorQuery raisedCholesterol() {
		return latestPerAdult("NCD-011", "b.value_numeric >= 5.0", LAB,
		    "#.test_code = 'cholesterol_total' AND #.value_numeric IS NOT NULL", "resulted_at", "result_obs_id");
	}

	/**
	 * A person's latest qualifying row in the period and scope decides whether they are in the
	 * numerator; every such person is in the denominator.
	 *
	 * @param qualifies a row predicate with {@code #} for the table alias
	 */
	private static IndicatorQuery latestPerAdult(String code, String raised, String table, String qualifies, String time,
	        String id) {
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "b.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(column(code, "NUM"), "pb.person_key", raised),
		        IndicatorSql.countDistinct(column(code, "DEN"), "pb.person_key", "1 = 1"),
		        IndicatorSql.percent(column(code, "PCT"), "COUNT(DISTINCT CASE WHEN " + raised + " THEN pb.person_key END)",
		            "COUNT(DISTINCT pb.person_key)")),
		    "FROM " + table + " b" + Sql.joinPersonKey("b", "pb") + Sql.joinPerson("b", "p") + "\n" //
		            + "WHERE " + qualifies.replace("#", "b") + "\n" //
		            + "  AND " + Sql.inPeriod("b." + time) + "\n" //
		            + "  AND " + g.inScope("b") + "\n" //
		            + "  AND " + Sql.ageYears("p.birthdate", "b." + time) + " >= 18\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM " + table + " c" + Sql.joinPersonKey("c", "pc") + "\n" //
		            + "                  WHERE pc.person_key = pb.person_key\n" //
		            + "                    AND " + qualifies.replace("#", "c") + "\n" //
		            + "                    AND " + Sql.inPeriod("c." + time) + "\n" //
		            + "                    AND " + g.inSameScope("c", "b") + "\n" //
		            + "                    AND " + Sql.before("b." + time, "c." + time, "b." + id + " < c." + id) + ")"),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	/**
	 * NCD-015: people aged 18+ with a renal diagnosis (ICD-10 N00-N19) in the period, over people aged
	 * 18+ with a creatinine, urea or eGFR result in the period. The two are independent (ambiguity 8).
	 */
	static IndicatorQuery renalDisease() {
		String code = "NCD-015";
		String diagnosed = "x.part = 'N'";
		String tested = "x.part = 'D'";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "x.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(column(code, "NUM"), "x.person_key", diagnosed),
		        IndicatorSql.countDistinct(column(code, "DEN"), "x.person_key", tested),
		        IndicatorSql.percent(column(code, "PCT"), "COUNT(DISTINCT CASE WHEN " + diagnosed + " THEN x.person_key END)",
		            "COUNT(DISTINCT CASE WHEN " + tested + " THEN x.person_key END)")),
		    "FROM (" + renalPart(g, "N", DIAGNOSIS, "#.icd10_group = 'renal'", "encounter_datetime") //
		            + "\n      UNION ALL\n      " //
		            + renalPart(g, "D", LAB, "#.test_group = 'renal' AND #.result_obs_id <> 0", "resulted_at") + ") x"),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	private static String renalPart(Grouping g, String part, String table, String qualifies, String time) {
		return "SELECT '" + part + "' AS part, r.facility_location_id, pr.person_key\n" //
		        + "      FROM " + table + " r" + Sql.joinPersonKey("r", "pr") + Sql.joinPerson("r", "p") + "\n" //
		        + "      WHERE " + qualifies.replace("#", "r") + "\n" //
		        + "        AND " + Sql.inPeriod("r." + time) + "\n" //
		        + "        AND " + g.inScope("r") + "\n" //
		        + "        AND " + Sql.ageYears("p.birthdate", "r." + time) + " >= 18";
	}
}
