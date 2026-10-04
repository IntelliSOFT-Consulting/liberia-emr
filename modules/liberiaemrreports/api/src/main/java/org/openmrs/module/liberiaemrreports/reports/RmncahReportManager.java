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
 * The RMNCAH sheet: the Feasible-now rows RMNCAH-017, 018, 019, 020, 021, 026 and 028. The readings
 * are the matrix's ({@code docs/reporting/feasibility/rmncah-nutrition.csv}) as
 * {@code qa/reporting/README.md} fixes them (ambiguities 4 to 7 and 11).
 */
@Component
public class RmncahReportManager extends LiberiaReportManager {
	
	/** Repeated in this file's SQL. */
	private static final String ENCOUNTER_DATETIME = "d.encounter_datetime";
	
	/** Repeated in this file's SQL. */
	private static final String FACILITY_LOCATION_ID = "f.facility_location_id";

	/** Episode window for diarrhoea and pneumonia (ambiguity 6). */
	static final int CHILD_EPISODE_DAYS = 14;

	static final String DIAGNOSIS = "${etl}.mamba_fact_malaria_diagnosis";

	@Override
	public ReportSheet getSheet() {
		return ReportSheet.RMNCAH;
	}

	@Override
	protected List<String> getNotes() {
		return Arrays.asList(
		    "RMNCAH-017: numerator only (the population of women aged 15-49 is not in the EMR); socio-economic status/wealth quintile, urban/rural and education not captured",
		    "RMNCAH-018: urban/rural not captured",
		    "RMNCAH-019: numerator only (the catchment under-5 population is not in the EMR); urban/rural not captured",
		    "RMNCAH-020: numerator only (the under-5 population is not in the EMR); socio-economic status/wealth quintile not captured",
		    "RMNCAH-021: socio-economic status/wealth quintile not captured",
		    "RMNCAH-026: denominator is the facility's deliveries with a delivery method recorded (the sheet's is expected deliveries, a population); facility type, socio-economic status/wealth quintile and cadre of professionals not captured",
		    "RMNCAH-028: numerator only (expected deliveries are a population); counts only home deliveries that reach a PNC visit; facility type, socio-economic status/wealth quintile and cadre of professionals not captured");
	}

	@Override
	protected void addDataSets(ReportDefinition reportDefinition) {
		addIndicators(reportDefinition, queries());
	}

	static List<IndicatorQuery> queries() {
		return Arrays.asList(contraceptivePrevalence(), underFiveTreated("RMNCAH-018", "diarrhoea", "is_oral_rehydration"),
		    underFiveNewEpisodes("RMNCAH-019", "diarrhoea"), underFiveNewEpisodes("RMNCAH-020", "pneumonia"),
		    underFiveTreated("RMNCAH-021", "pneumonia", "is_pneumonia_antibiotic"), caesareanDeliveries(), homeDeliveries());
	}

	/**
	 * RMNCAH-017, numerator only: women 15-49 at the period end whose latest Family Planning encounter
	 * on or before it (any form version) records a modern method still inside its protection window,
	 * with no removal date (ambiguity 5).
	 */
	static IndicatorQuery contraceptivePrevalence() {
		String num = column("RMNCAH-017", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, FACILITY_LOCATION_ID,
		    Arrays.asList(IndicatorSql.countDistinct(num, "f.person_key", "f.is_modern_method = 1")),
		    "FROM ${etl}.mamba_fact_rmncah_family_planning f\n" //
		            + "WHERE f.encounter_datetime <= :endDate\n" //
		            + "  AND " + g.inScope("f") + "\n" //
		            + "  AND f.gender = 'F'\n" //
		            + "  AND " + Sql.ageYears("f.birthdate", ":endDate") + " BETWEEN 15 AND 49\n" //
		            + "  AND f.method_removed_date IS NULL\n" //
		            + "  AND f.protected_until >= CAST(:endDate AS DATE)\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM ${etl}.mamba_fact_rmncah_family_planning l\n" //
		            + "                  WHERE l.person_key = f.person_key\n" //
		            + "                    AND l.encounter_datetime <= :endDate\n" //
		            + "                    AND " + g.inSameScope("l", "f") + "\n" //
		            + "                    AND " + Sql.before("f.encounter_datetime", "l.encounter_datetime",
		                "f.encounter_id < l.encounter_id") + ")"),
		    num);
	}

	/**
	 * RMNCAH-018 and 021: children under 5 (0-59 months at the diagnosis) with a diagnosis in the group
	 * in the period, and those of them given a drug of the class in the same visit (ambiguity 7). Each
	 * child counts once. The drug order is read, not a dispense, so central equals the facility.
	 *
	 * @param icd10Group {@code mamba_fact_malaria_diagnosis.icd10_group}
	 * @param drugFlag the {@code mamba_fact_malaria_drug} class column
	 */
	static IndicatorQuery underFiveTreated(String code, String icd10Group, String drugFlag) {
		String num = column(code, "NUM");
		String den = column(code, "DEN");
		String treated = "x.treated = 1";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "x.facility_location_id",
		    Arrays.asList(IndicatorSql.countDistinct(num, "x.person_key", treated),
		        IndicatorSql.countDistinct(den, "x.person_key", "1 = 1"),
		        IndicatorSql.percent(column(code, "PCT"), "COUNT(DISTINCT CASE WHEN " + treated + " THEN x.person_key END)",
		            "COUNT(DISTINCT x.person_key)")),
		    "FROM (SELECT d.facility_location_id, pc.person_key,\n" //
		            + "             CASE WHEN EXISTS (SELECT 1 FROM ${etl}.mamba_fact_malaria_drug r\n" //
		            + "                               WHERE r.visit_id = d.visit_id AND r." + drugFlag + " = 1)\n" //
		            + "                  THEN 1 ELSE 0 END AS treated\n" //
		            + "      FROM " + DIAGNOSIS + " d" + Sql.joinPersonKey("d", "pc") + Sql.joinPerson("d", "p") + "\n" //
		            + "      WHERE d.icd10_group = '" + icd10Group + "'\n" //
		            + "        AND " + Sql.inPeriod(ENCOUNTER_DATETIME) + "\n" //
		            + "        AND " + g.inScope("d") + "\n" //
		            + "        AND " + Sql.ageMonths("p.birthdate", ENCOUNTER_DATETIME) + " BETWEEN 0 AND 59) x"),
		    num, den, column(code, "PCT"));
	}

	/**
	 * RMNCAH-019 and 020, numerator only: new episodes in children under 5. A diagnosis starts an
	 * episode unless the same person had one in the same group, in scope, at most
	 * {@value #CHILD_EPISODE_DAYS} days before it, looking back across the period start (ambiguity 6).
	 */
	static IndicatorQuery underFiveNewEpisodes(String code, String icd10Group) {
		String num = column(code, "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, "d.facility_location_id",
		    Arrays.asList(IndicatorSql.count(num, "1 = 1")),
		    "FROM " + DIAGNOSIS + " d" + Sql.joinPersonKey("d", "pc") + Sql.joinPerson("d", "p") + "\n" //
		            + "WHERE d.icd10_group = '" + icd10Group + "'\n" //
		            + "  AND " + Sql.inPeriod(ENCOUNTER_DATETIME) + "\n" //
		            + "  AND " + g.inScope("d") + "\n" //
		            + "  AND " + Sql.ageMonths("p.birthdate", ENCOUNTER_DATETIME) + " BETWEEN 0 AND 59\n" //
		            + "  AND NOT EXISTS (SELECT 1 FROM " + DIAGNOSIS + " e" + Sql.joinPersonKey("e", "pe") + "\n" //
		            + "                  WHERE pe.person_key = pc.person_key\n" //
		            + "                    AND e.icd10_group = d.icd10_group\n" //
		            + "                    AND " + g.inSameScope("e", "d") + "\n" //
		            + "                    AND " + Sql.before("e.encounter_datetime", ENCOUNTER_DATETIME,
		                "e.diagnosis_id < d.diagnosis_id") + "\n" //
		            + "                    AND " + Sql.withinDaysBefore("e.encounter_datetime", ENCOUNTER_DATETIME,
		                CHILD_EPISODE_DAYS) + ")"),
		    num);
	}

	/**
	 * RMNCAH-026: caesarean deliveries over deliveries with a delivery method, one per 42-day delivery
	 * episode, in the period of the episode's first encounter. The denominator is the facility's (the
	 * sheet's is a population).
	 */
	static IndicatorQuery caesareanDeliveries() {
		String code = "RMNCAH-026";
		String caesarean = "f.episode_delivery_method = 'caesarean'";
		String anyMethod = "f.episode_delivery_method IS NOT NULL";
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, FACILITY_LOCATION_ID,
		    Arrays.asList(IndicatorSql.count(column(code, "NUM"), caesarean),
		        IndicatorSql.count(column(code, "DEN"), anyMethod),
		        IndicatorSql.percent(column(code, "PCT"), "SUM(CASE WHEN " + caesarean + " THEN 1 ELSE 0 END)",
		            "SUM(CASE WHEN " + anyMethod + " THEN 1 ELSE 0 END)")),
		    "FROM ${etl}.mamba_fact_rmncah_delivery f\n" //
		            + "WHERE f.is_episode_start = 1\n" //
		            + "  AND " + Sql.inPeriod("f.episode_start_datetime") + "\n" //
		            + "  AND " + g.inScope("f")),
		    column(code, "NUM"), column(code, "DEN"), column(code, "PCT"));
	}

	/**
	 * RMNCAH-028, numerator only: deliveries at home, as reported at Mother PNC, one per 42-day
	 * episode, in the period of the episode's first PNC encounter.
	 */
	static IndicatorQuery homeDeliveries() {
		String num = column("RMNCAH-028", "NUM");
		return IndicatorQuery.of(g -> IndicatorQuery.select(g, FACILITY_LOCATION_ID,
		    Arrays.asList(IndicatorSql.count(num, "f.episode_place_of_delivery = 'home'")),
		    "FROM ${etl}.mamba_fact_rmncah_mother_pnc f\n" //
		            + "WHERE f.is_episode_start = 1\n" //
		            + "  AND " + Sql.inPeriod("f.episode_start_datetime") + "\n" //
		            + "  AND " + g.inScope("f")),
		    num);
	}
}
