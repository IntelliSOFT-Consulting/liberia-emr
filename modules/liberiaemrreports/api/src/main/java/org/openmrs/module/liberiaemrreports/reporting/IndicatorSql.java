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
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Builds the aggregate select-list of an indicator data set, with the column naming of
 * {@code docs/reporting/README.md} §3.3: {@code <CODE>_<part>[<suffix>...]}.
 * <p>
 * Every expression is an aggregate, so a data set built from these returns counts only (ADR 0010
 * decision 6). Count people with {@link #countDistinct}: at central a person can appear at more
 * than one facility, and a patient-level denominator counts each person once.
 */
public final class IndicatorSql {
	
	private IndicatorSql() {
	}
	
	/**
	 * @param code the workbook code, e.g. {@code MAL-004}
	 * @param part e.g. {@code NUM}, {@code DEN}
	 * @return e.g. {@code MAL_004_NUM}
	 */
	public static String column(String code, String part) {
		return (code + "_" + part).toUpperCase(Locale.ROOT).replace('-', '_');
	}
	
	/**
	 * {@code COALESCE(SUM(CASE WHEN predicate THEN 1 ELSE 0 END), 0) AS column}: counts events, and is
	 * 0 rather than null over no rows.
	 */
	public static String count(String column, String predicate) {
		return "COALESCE(SUM(CASE WHEN (" + predicate + ") THEN 1 ELSE 0 END), 0) AS " + column;
	}
	
	/**
	 * The value column, 0 to 100, null when the denominator is 0. The numerator and denominator are
	 * repeated as expressions, not referenced by alias, which neither MariaDB nor H2 allows in the same
	 * select list.
	 *
	 * @param column e.g. {@code MAL_004_PCT}
	 */
	public static String percent(String column, String numeratorExpr, String denominatorExpr) {
		return "CASE WHEN (" + denominatorExpr + ") = 0 THEN NULL ELSE 100.0 * (" + numeratorExpr + ") / (" + denominatorExpr
		        + ") END AS " + column;
	}
	
	/** {@code COUNT(DISTINCT CASE WHEN predicate THEN id END) AS column}: counts people or visits. */
	public static String countDistinct(String column, String idExpr, String predicate) {
		return "COUNT(DISTINCT CASE WHEN (" + predicate + ") THEN " + idExpr + " END) AS " + column;
	}
	
	/**
	 * The total and one column per option of each dimension, and of every combination of them. With
	 * {@code sex} and an age list this yields {@code X}, {@code X_F}, {@code X_M}, {@code X_LT1}, ...,
	 * {@code X_F_LT1}, ....
	 *
	 * @param column the total's column name
	 * @param idExpr null to count events, or the id to count distinct
	 * @param predicate what the indicator counts
	 * @param dimensions zero or more option lists
	 */
	@SafeVarargs
	public static List<String> disaggregated(String column, String idExpr, String predicate,
	        List<Disaggregation>... dimensions) {
		List<String> suffixes = new ArrayList<String>(Collections.singletonList(""));
		List<String> predicates = new ArrayList<String>(Collections.singletonList(predicate));
		for (List<Disaggregation> dimension : dimensions) {
			int existing = suffixes.size();
			for (int i = 0; i < existing; i++) {
				for (Disaggregation option : dimension) {
					suffixes.add(suffixes.get(i) + option.getSuffix());
					predicates.add(predicates.get(i) + ") AND (" + option.getPredicate());
				}
			}
		}
		List<String> columns = new ArrayList<String>();
		for (int i = 0; i < suffixes.size(); i++) {
			String name = column + suffixes.get(i);
			columns.add(idExpr == null ? count(name, predicates.get(i)) : countDistinct(name, idExpr, predicates.get(i)));
		}
		return columns;
	}
	
	/**
	 * @param columns aggregate expressions
	 * @param fromClause everything from {@code FROM} on
	 * @return a complete SELECT
	 */
	public static String select(List<String> columns, String fromClause) {
		StringBuilder sb = new StringBuilder("SELECT ");
		for (int i = 0; i < columns.size(); i++) {
			sb.append(i == 0 ? "" : ",\n       ").append(columns.get(i));
		}
		return sb.append("\n").append(fromClause).toString();
	}
}
