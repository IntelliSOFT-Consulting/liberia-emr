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
 * The Nutrition sheet: the Feasible-now rows NUT-005, NUT-008 and NUT-009, read as
 * {@code qa/reporting/README.md} fixes them (ambiguities 2 to 4). NUT-005 and NUT-009 follow the
 * indicator names while the MOH decides the sheet's conflicting numerator texts.
 */
@Component
public class NutritionReportManager extends LiberiaReportManager {
	
	/** Repeated in this file's SQL. */
	private static final String PERSON_KEY = "a.person_key";
	
	/** Repeated in this file's SQL. */
	private static final String ENCOUNTER_DATETIME = "a.encounter_datetime";

	static final String ANTHROPOMETRY = "${etl}.mamba_fact_nutrition_anthropometry";

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.NUTRITION;
	}

	@Override
	protected List<String> getNotes() {
		return Arrays.asList(
		    "NUT-005: numerator only (the population of children aged 6-11 months is not in the EMR); implemented as named (one Vitamin A Blue 100,000 IU dose) pending the MOH's decision on the sheet's numerator text; socio-economic status/wealth quintile and urban/rural not captured",
		    "NUT-008: denominator is children aged 6-59 months with a MUAC recorded (the sheet's is a sampled population); socio-economic status/wealth quintile and urban/rural not captured",
		    "NUT-009: count indicator (moderate wasting, weight-for-height z-score in [-3, -2)), implemented as named pending the MOH's decision on the sheet's numerator text; socio-economic status/wealth quintile and urban/rural not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addIndicators(reportDefinition, queries());
	}

	static List<IndicatorQuery> queries() {
		return Arrays.asList(vitaminABlue(), lowMuac(), moderateWasting());
	}

	/**
	 * NUT-005, numerator only: children aged 6-11 months at the dose who got Vitamin A Blue (100 000
	 * IU), from the Immunization form or a drug order. Each child counts once.
	 */
	static IndicatorQuery vitaminABlue() {
		String num = column("NUT-005", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "f.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(num, "f.person_key", "1 = 1")),
		    "FROM ${etl}.mamba_fact_nutrition_vitamin_a f\n" //
		            + "WHERE f.dose_iu = 100000\n" //
		            + "  AND f.age_months BETWEEN 6 AND 11\n" //
		            + "  AND " + Sql.inPeriod("f.event_datetime") + "\n" //
		            + "  AND " + g.inScope("f")),
		    num);
	}

	/**
	 * NUT-008: children aged 6-59 months with a MUAC in the period, and those whose latest MUAC in it
	 * is under 11.5 cm.
	 */
	static IndicatorQuery lowMuac() {
		String code = "NUT-008";
		String low = "a.muac_cm < 11.5";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "a.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(column(code, "NUM"), PERSON_KEY, low),
		        IndicatorSql.countDistinct(column(code, "DEN"), PERSON_KEY, "1 = 1"),
		        IndicatorSql.percent(column(code, "PCT"), "COUNT(DISTINCT CASE WHEN " + low + " THEN a.person_key END)",
		            "COUNT(DISTINCT a.person_key)")),
		    "FROM " + ANTHROPOMETRY + " a\n" //
		            + "WHERE " + muacChild("a") + "\n" //
		            + "  AND " + Sql.inPeriod(ENCOUNTER_DATETIME) + "\n" //
		            + "  AND " + g.inScope("a") + "\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM " + ANTHROPOMETRY + " b\n" //
		            + "                  WHERE b.person_key = a.person_key\n" //
		            + "                    AND " + muacChild("b") + "\n" //
		            + "                    AND " + Sql.inPeriod("b.encounter_datetime") + "\n" //
		            + "                    AND " + g.inSameScope("b", "a") + "\n" //
		            + "                    AND " + Sql.before(ENCOUNTER_DATETIME, "b.encounter_datetime",
		                "a.encounter_id < b.encounter_id") + ")"),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	private static String muacChild(String alias) {
		return alias + ".muac_cm IS NOT NULL AND " + alias + ".age_months BETWEEN 6 AND 59";
	}
	
	/**
	 * NUT-009, a count: children aged 6-59 months with a weight-for-height z-score in [-3, -2) in the
	 * period, computed by the ETL from same-encounter weight and height. Each child counts once.
	 */
	static IndicatorQuery moderateWasting() {
		String num = column("NUT-009", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "a.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(num, PERSON_KEY, "a.whz >= -3 AND a.whz < -2")),
		    "FROM " + ANTHROPOMETRY + " a\n" //
		            + "WHERE a.age_months BETWEEN 6 AND 59\n" //
		            + "  AND " + Sql.inPeriod(ENCOUNTER_DATETIME) + "\n" //
		            + "  AND " + g.inScope("a")),
		    num);
	}
}
