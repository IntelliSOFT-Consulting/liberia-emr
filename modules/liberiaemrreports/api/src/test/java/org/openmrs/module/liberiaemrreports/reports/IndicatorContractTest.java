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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;
import org.openmrs.module.liberiaemrreports.reporting.Grouping;
import org.openmrs.module.liberiaemrreports.reporting.IndicatorQuery;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;

/**
 * The column and SQL contract of {@code docs/reporting/README.md} §3 and ADR 0010 decisions 6 and 7,
 * checked on the SQL every sheet builds, for both roles and both groupings.
 */
public class IndicatorContractTest {

	/** The 21 Feasible-now rows, and whether each is numerator only (no _DEN, no _PCT). */
	private static final Map<String, Boolean> NUMERATOR_ONLY = new LinkedHashMap<String, Boolean>();
	static {
		for (String code : Arrays.asList("RMNCAH_017", "RMNCAH_019", "RMNCAH_020", "RMNCAH_028", "NUT_005", "NUT_009",
		    "MAL_004", "NCD_002", "NCD_005")) {
			NUMERATOR_ONLY.put(code, true);
		}
		for (String code : Arrays.asList("RMNCAH_018", "RMNCAH_021", "RMNCAH_026", "NUT_008", "MAL_002", "MAL_003",
		    "NCD_007", "NCD_011", "NCD_015", "EMR_OPS_007", "EMR_OPS_008", "EMR_OPS_015")) {
			NUMERATOR_ONLY.put(code, false);
		}
	}

	private static final Pattern UUID = Pattern
	        .compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\\b\\d+A{10,}\\b");

	private static final Pattern TABLE_REFERENCE = Pattern.compile("\\b(?:FROM|JOIN)\\s+(\\S+)", Pattern.CASE_INSENSITIVE);

	private static final Pattern COLUMN = Pattern.compile("([A-Z]+(?:_[A-Z]+)?_\\d{3})_(NUM|DEN|PCT)(_[A-Z0-9_]+)?");

	private static List<IndicatorQuery> all(InstanceRole role) {
		List<IndicatorQuery> queries = new ArrayList<IndicatorQuery>();
		queries.addAll(RmncahReportManager.queries());
		queries.addAll(NutritionReportManager.queries());
		queries.addAll(MalariaReportManager.queries());
		queries.addAll(NcdReportManager.queries());
		queries.addAll(EmrOpsReportManager.queries(role));
		return queries;
	}

	@Test
	public void shouldReturnExactlyTheContractColumnsOfThe21FeasibleNowRows() {
		TreeSet<String> codes = new TreeSet<String>();
		for (IndicatorQuery query : all(InstanceRole.FACILITY)) {
			for (String column : query.getColumns()) {
				Matcher m = COLUMN.matcher(column);
				assertTrue("not a contract column name: " + column, m.matches());
				String code = m.group(1);
				assertTrue("not a Feasible-now row: " + code, NUMERATOR_ONLY.containsKey(code));
				assertFalse(code + " is numerator only", NUMERATOR_ONLY.get(code) && !"NUM".equals(m.group(2)));
				codes.add(code);
			}
			for (String part : new String[] { "_DEN", "_PCT" }) {
				for (String column : query.getColumns()) {
					if (column.endsWith("_NUM") && !NUMERATOR_ONLY.get(column.substring(0, column.length() - 4))) {
						String sibling = column.substring(0, column.length() - 4) + part;
						assertTrue(column + " needs " + sibling, query.getColumns().contains(sibling));
					}
				}
			}
		}
		assertEquals(new TreeSet<String>(NUMERATOR_ONLY.keySet()), codes);
	}

	@Test
	public void shouldReadOnlyTheEtlSchemaAndHoldNoUuid() {
		for (InstanceRole role : InstanceRole.values()) {
			List<IndicatorQuery> queries = all(role);
			List<String> sqls = new ArrayList<String>();
			sqls.add(IndicatorQuery.indicatorsSql(queries));
			sqls.add(IndicatorQuery.byFacilitySql(queries));
			for (IndicatorQuery query : queries) {
				for (Grouping grouping : Grouping.values()) {
					sqls.add(query.getSql(grouping));
				}
			}
			for (String sql : sqls) {
				assertFalse("a UUID literal in " + sql, UUID.matcher(sql).find());
				Matcher m = TABLE_REFERENCE.matcher(sql);
				while (m.find()) {
					String table = m.group(1);
					assertTrue("not an ETL table or a subquery: " + table + " in\n" + sql,
					    table.startsWith("${etl}.mamba_") || table.startsWith("("));
				}
			}
		}
	}
}
