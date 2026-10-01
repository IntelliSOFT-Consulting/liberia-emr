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
import java.util.function.Function;

/**
 * One indicator (or a few that share a source) as an aggregate SELECT over the ETL schema, written
 * once for both {@link Grouping}s.
 * <p>
 * For {@link Grouping#TOTAL} the SQL returns exactly one row: aggregates with no GROUP BY. For
 * {@link Grouping#BY_FACILITY} it returns one row per facility, keyed {@value Grouping#KEY}.
 * {@link #indicatorsSql} and {@link #byFacilitySql} join a sheet's queries into its two data sets.
 */
public final class IndicatorQuery {

	private final List<String> columns;

	private final Function<Grouping, String> sql;

	private IndicatorQuery(List<String> columns, Function<Grouping, String> sql) {
		this.columns = Collections.unmodifiableList(new ArrayList<String>(columns));
		this.sql = sql;
	}

	/**
	 * @param sql the query for a grouping; see {@link #select} for the usual shape
	 * @param columns the columns it returns besides {@value Grouping#KEY}, e.g. {@code MAL_004_NUM}
	 */
	public static IndicatorQuery of(Function<Grouping, String> sql, String... columns) {
		if (columns.length == 0) {
			throw new IllegalArgumentException("An indicator query returns at least one column");
		}
		return new IndicatorQuery(Arrays.asList(columns), sql);
	}

	public List<String> getColumns() {
		return columns;
	}

	public String getSql(Grouping grouping) {
		return sql.apply(grouping);
	}

	/**
	 * The usual shape: {@code SELECT [key,] aggregates FROM ... [GROUP BY key]}.
	 *
	 * @param facilityExpr the counted row's facility, e.g. {@code f.facility_location_id}
	 * @param aggregates from {@link IndicatorSql}
	 * @param fromClause everything from {@code FROM} on, with no GROUP BY
	 */
	public static String select(Grouping grouping, String facilityExpr, List<String> aggregates, String fromClause) {
		List<String> selectList = new ArrayList<String>();
		if (grouping == Grouping.BY_FACILITY) {
			selectList.add(facilityExpr + " AS " + Grouping.KEY);
		}
		selectList.addAll(aggregates);
		return IndicatorSql.select(selectList, fromClause + grouping.groupBy(facilityExpr));
	}

	/**
	 * The {@link LiberiaReportManager#INDICATORS} data set: every query's single row, side by side.
	 */
	public static String indicatorsSql(List<IndicatorQuery> queries) {
		List<String> selectList = new ArrayList<String>();
		StringBuilder from = new StringBuilder();
		for (int i = 0; i < queries.size(); i++) {
			String alias = "q" + i;
			for (String column : queries.get(i).getColumns()) {
				selectList.add(alias + "." + column);
			}
			from.append(i == 0 ? "FROM (" : "\nCROSS JOIN (").append(queries.get(i).getSql(Grouping.TOTAL)).append(") ")
			        .append(alias);
		}
		return IndicatorSql.select(selectList, from.toString());
	}

	/**
	 * The {@link LiberiaReportManager#BY_FACILITY} data set: one row per Health Facility in scope, named
	 * {@code facility_name}, with every query's columns. A facility with no events has counts of 0 and
	 * no percentage.
	 */
	public static String byFacilitySql(List<IndicatorQuery> queries) {
		List<String> selectList = new ArrayList<String>();
		selectList.add("fac.name AS facility_name");
		selectList.add("fac.uuid AS facility_uuid");
		StringBuilder from = new StringBuilder("FROM ${etl}.mamba_dim_location_hierarchy fac");
		for (int i = 0; i < queries.size(); i++) {
			String alias = "q" + i;
			for (String column : queries.get(i).getColumns()) {
				selectList.add(column.endsWith("_PCT") ? alias + "." + column : "COALESCE(" + alias + "." + column
				        + ", 0) AS " + column);
			}
			from.append("\nLEFT JOIN (").append(queries.get(i).getSql(Grouping.BY_FACILITY)).append(") ").append(alias)
			        .append(" ON ").append(alias).append(".").append(Grouping.KEY).append(" = fac.location_id");
		}
		from.append("\nWHERE fac.location_id = fac.facility_location_id\n  AND ").append(Grouping.TOTAL.inScope("fac"))
		        .append("\nORDER BY fac.name");
		return IndicatorSql.select(selectList, from.toString());
	}
}
