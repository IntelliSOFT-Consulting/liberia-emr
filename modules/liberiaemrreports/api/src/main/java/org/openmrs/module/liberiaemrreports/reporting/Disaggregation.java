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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * One column-suffix disaggregation of an indicator: a suffix and the SQL predicate an event must
 * meet to count under it ({@code docs/reporting/README.md} §3.3).
 * <p>
 * The reports are aggregate SQL over flat tables, not cohort queries, so a "dimension" here is a
 * set of predicates that {@link IndicatorSql} turns into one aggregate column per option, e.g.
 * {@code MAL_004_NUM_F}, {@code MAL_004_NUM_M}. Predicates reference columns of the query's own
 * FROM clause, passed in by the caller: this class knows no table.
 */
public final class Disaggregation {
	
	private final String suffix;
	
	private final String predicate;
	
	private Disaggregation(String suffix, String predicate) {
		this.suffix = suffix;
		this.predicate = predicate;
	}
	
	/**
	 * @param suffix appended to the column name, starting with {@code _}
	 * @param predicate SQL that is true for events in this option
	 */
	public static Disaggregation of(String suffix, String predicate) {
		if (suffix == null || !suffix.matches("_[A-Z0-9_]+")) {
			throw new IllegalArgumentException("A suffix is _ followed by upper-case letters, digits or _: " + suffix);
		}
		return new Disaggregation(suffix, predicate);
	}
	
	public String getSuffix() {
		return suffix;
	}
	
	public String getPredicate() {
		return predicate;
	}
	
	/**
	 * @param genderColumn the person's gender column, holding OpenMRS's {@code F}/{@code M}
	 * @return {@code _F} and {@code _M}
	 */
	public static List<Disaggregation> sex(String genderColumn) {
		return Arrays.asList(of("_F", genderColumn + " = 'F'"), of("_M", genderColumn + " = 'M'"));
	}
	
	/**
	 * An age band in completed years at the event, {@code [fromYears, toYears)}.
	 *
	 * @param suffix e.g. {@code _1_4}
	 * @param fromYears inclusive lower bound, or null for none
	 * @param toYears exclusive upper bound, or null for none
	 * @param ageInYearsExpr SQL for the age in completed years, see {@link #ageInYears}
	 */
	public static Disaggregation ageBand(String suffix, Integer fromYears, Integer toYears, String ageInYearsExpr) {
		List<String> parts = new ArrayList<String>();
		if (fromYears != null) {
			parts.add(ageInYearsExpr + " >= " + fromYears);
		}
		if (toYears != null) {
			parts.add(ageInYearsExpr + " < " + toYears);
		}
		if (parts.isEmpty()) {
			throw new IllegalArgumentException("An age band needs at least one bound");
		}
		StringBuilder sb = new StringBuilder("(");
		for (int i = 0; i < parts.size(); i++) {
			sb.append(i == 0 ? "" : " AND ").append(parts.get(i));
		}
		return of(suffix, sb.append(")").toString());
	}
	
	/**
	 * The bands the README names as the common case: {@code _LT1}, {@code _1_4}, {@code _5_14},
	 * {@code _15_49}, {@code _50PLUS}. A sheet whose workbook defines other bands builds its own with
	 * {@link #ageBand}.
	 */
	public static List<Disaggregation> standardAgeBands(String ageInYearsExpr) {
		return Collections.unmodifiableList(Arrays.asList(ageBand("_LT1", null, 1, ageInYearsExpr),
		    ageBand("_1_4", 1, 5, ageInYearsExpr), ageBand("_5_14", 5, 15, ageInYearsExpr),
		    ageBand("_15_49", 15, 50, ageInYearsExpr), ageBand("_50PLUS", 50, null, ageInYearsExpr)));
	}
	
	/**
	 * @return MariaDB SQL for completed years between a birthdate and an event date
	 */
	public static String ageInYears(String birthdateColumn, String eventDateColumn) {
		return "TIMESTAMPDIFF(YEAR, " + birthdateColumn + ", " + eventDateColumn + ")";
	}
}
