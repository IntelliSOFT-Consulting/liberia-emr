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

/**
 * SQL fragments the sheets share. Every one is plain SQL that MariaDB 10.11 and the tests' H2
 * both run, over the ETL tables of {@code modules/mambaetl/README.md}.
 */
final class Sql {

	/** The fact's event time is in the period (§3.2: whole days, already widened). */
	static String inPeriod(String eventExpr) {
		return eventExpr + " BETWEEN :startDate AND :endDate";
	}

	/**
	 * Joins {@code mamba_dim_person_cpi} as {@code keyAlias}, whose {@code person_key} counts a person
	 * once (at central, across that person's records).
	 */
	static String joinPersonKey(String factAlias, String keyAlias) {
		return "\nINNER JOIN ${etl}.mamba_dim_person_cpi " + keyAlias + " ON " + keyAlias + ".person_id = " + factAlias
		        + ".client_id";
	}

	/** Joins core's {@code mamba_dim_person} as {@code personAlias}, for birthdate and gender. */
	static String joinPerson(String factAlias, String personAlias) {
		return "\nINNER JOIN ${etl}.mamba_dim_person " + personAlias + " ON " + personAlias + ".person_id = " + factAlias
		        + ".client_id";
	}

	/** Completed months at the event (qa/reporting README, ambiguity 11). */
	static String ageMonths(String birthdateExpr, String atExpr) {
		return "TIMESTAMPDIFF(MONTH, " + birthdateExpr + ", " + atExpr + ")";
	}

	/** Completed years at the event. */
	static String ageYears(String birthdateExpr, String atExpr) {
		return "TIMESTAMPDIFF(YEAR, " + birthdateExpr + ", " + atExpr + ")";
	}

	/**
	 * The inner row comes before the outer one: an earlier time, or the same time and
	 * {@code tieBreak}.
	 */
	static String before(String innerTime, String outerTime, String tieBreak) {
		return "(" + innerTime + " < " + outerTime + " OR (" + innerTime + " = " + outerTime + " AND " + tieBreak + "))";
	}

	/** The inner event's day is at most {@code days} days before the outer event's day. */
	static String withinDaysBefore(String innerTime, String outerTime, int days) {
		return "TIMESTAMPDIFF(DAY, CAST(" + innerTime + " AS DATE), CAST(" + outerTime + " AS DATE)) <= " + days;
	}

	private Sql() {
	}
}
