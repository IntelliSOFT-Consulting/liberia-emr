/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.etl;

import static org.junit.Assert.assertEquals;

import java.util.Properties;

import org.junit.Test;

public class EtlSchemaTest {
	
	private static Properties withSchema(String value) {
		Properties p = new Properties();
		if (value != null) {
			p.setProperty(EtlSchema.ETL_DATABASE_PROPERTY, value);
		}
		return p;
	}
	
	@Test
	public void resolve_shouldFallBackToTheDefaultWithoutRuntimeProperties() {
		assertEquals("liberiaemr_etl", EtlSchema.resolve(null));
	}
	
	@Test
	public void resolve_shouldFallBackToTheDefaultWhenUnsetOrBlank() {
		assertEquals(EtlSchema.DEFAULT_ETL_DATABASE, EtlSchema.resolve(withSchema(null)));
		assertEquals(EtlSchema.DEFAULT_ETL_DATABASE, EtlSchema.resolve(withSchema("")));
		assertEquals(EtlSchema.DEFAULT_ETL_DATABASE, EtlSchema.resolve(withSchema("   ")));
	}
	
	@Test
	public void resolve_shouldUseAConfiguredBareIdentifier() {
		assertEquals("county_etl_2", EtlSchema.resolve(withSchema("county_etl_2")));
		assertEquals("Trimmed_Etl", EtlSchema.resolve(withSchema("  Trimmed_Etl ")));
	}
	
	@Test
	public void resolve_shouldRejectAnythingThatIsNotABareIdentifier() {
		String[] unsafe = { "etl; DROP DATABASE openmrs", "openmrs.person", "`etl`", "etl-db", "etl$", "etl db",
		        "etl/*x*/" };
		for (String value : unsafe) {
			assertEquals(value, EtlSchema.DEFAULT_ETL_DATABASE, EtlSchema.resolve(withSchema(value)));
		}
	}
	
	@Test
	public void qualify_shouldReplaceEveryToken() {
		assertEquals("SELECT 1 FROM s.a JOIN s.b", EtlSchema.qualify("SELECT 1 FROM ${etl}.a JOIN ${etl}.b", "s"));
	}
}
