/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.audit;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class AuditLogCsvTest {

	@Test
	public void quotesWhatRfc4180Requires() {
		assertEquals("plain", AuditLogCsv.cell("plain"));
		assertEquals("\"a, b\"", AuditLogCsv.cell("a, b"));
		assertEquals("\"say \"\"hi\"\"\"", AuditLogCsv.cell("say \"hi\""));
		assertEquals("\"two\nlines\"", AuditLogCsv.cell("two\nlines"));
		assertEquals("", AuditLogCsv.cell(null));
	}

	@Test
	public void defusesSpreadsheetFormulas() {
		assertEquals("\"'=HYPERLINK(\"\"x\"\")\"", AuditLogCsv.cell("=HYPERLINK(\"x\")"));
		assertEquals("\"'+1\"", AuditLogCsv.cell("+1"));
		assertEquals("\"'-1\"", AuditLogCsv.cell("-1"));
		assertEquals("\"'@SUM(A1)\"", AuditLogCsv.cell("@SUM(A1)"));
	}

	@Test
	public void writesOneLinePerRow() {
		Map<String, Object> user = new LinkedHashMap<String, Object>();
		user.put("uuid", "u-1");
		user.put("username", "admin");
		Map<String, Object> change = new LinkedHashMap<String, Object>();
		change.put("property", "name");
		change.put("previous", "Old");
		change.put("current", "New");
		Map<String, Object> row = new LinkedHashMap<String, Object>();
		row.put("dateCreated", "2026-09-30T10:00:00.000+0000");
		row.put("action", "UPDATED");
		row.put("type", "org.openmrs.Location");
		row.put("identifier", "7");
		row.put("user", user);
		row.put("uuid", "r-1");
		row.put("parentUuid", null);
		row.put("changes", Collections.singletonList(change));
		assertEquals("2026-09-30T10:00:00.000+0000,UPDATED,org.openmrs.Location,7,admin,u-1,r-1,,name: Old -> New\r\n",
		    AuditLogCsv.row(row));
		assertEquals("date,action,type,identifier,username,user_uuid,uuid,parent_uuid,values\r\n", AuditLogCsv.header());
	}

	@Test
	public void flattensALastState() {
		Map<String, Object> name = new LinkedHashMap<String, Object>();
		name.put("property", "name");
		name.put("value", "Ward");
		Map<String, Object> retired = new LinkedHashMap<String, Object>();
		retired.put("property", "retired");
		retired.put("value", "false");
		Map<String, Object> row = new LinkedHashMap<String, Object>();
		row.put("lastState", Arrays.asList(name, retired));
		assertEquals("name = Ward | retired = false", AuditLogCsv.values(row));
	}
}
