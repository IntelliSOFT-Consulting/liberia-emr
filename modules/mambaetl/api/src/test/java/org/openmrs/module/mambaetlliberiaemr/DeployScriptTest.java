/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 */
package org.openmrs.module.mambaetlliberiaemr;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

import org.junit.BeforeClass;
import org.junit.Test;

/**
 * The deploy script this jar ships, as core's JdbcFlattenDatabaseDao will load it: the build
 * compiled it from core 3.0.0 and src/main/mamba/_etl in this same `mvn package` (ADR 0010
 * decision 2). These are the properties a non-SUPER ETL user on MariaDB 10.11 depends on.
 */
public class DeployScriptTest {

	/** The classpath resource core loads; see JdbcFlattenDatabaseDao.ETL_DEPLOY_SQL. */
	private static final String DEPLOY_SQL = "mamba/jdbc_create_stored_procedures.sql";

	private static String script;

	@BeforeClass
	public static void load() throws IOException {
		InputStream in = DeployScriptTest.class.getClassLoader().getResourceAsStream(DEPLOY_SQL);
		assertNotNull(DEPLOY_SQL + " is not on the classpath: the build did not compile it", in);
		try {
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			byte[] buf = new byte[8192];
			int n;
			while ((n = in.read(buf)) != -1) {
				out.write(buf, 0, n);
			}
			script = new String(out.toByteArray(), StandardCharsets.UTF_8);
		}
		finally {
			in.close();
		}
	}

	@Test
	public void hasNoSetGlobal_whichNeedsSuper() {
		assertFalse(Pattern.compile("SET\\s+GLOBAL", Pattern.CASE_INSENSITIVE).matcher(script).find());
	}

	@Test
	public void hasNoDelimiterDirective_whichJdbcCannotRun() {
		assertFalse(Pattern.compile("(?im)^\\s*DELIMITER\\b").matcher(script).find());
	}

	@Test
	public void hasNoUnresolvedContentVariable() {
		assertFalse(script.contains("${var."));
	}

	@Test
	public void keepsTheRuntimeSchemaPlaceholders_soOneBuildServesEveryInstance() {
		assertTrue(script.contains("mamba_source_db"));
		assertTrue(script.contains("mamba_etl_db"));
		assertFalse("the build-time schema name leaked into the shipped script", script.contains("liberiaemr_etl"));
	}

	@Test
	public void createsTheBaseDerivedTablesAndTheCaller() {
		assertTrue(script.contains("CREATE PROCEDURE sp_mamba_dim_location_hierarchy()"));
		assertTrue(script.contains("CREATE PROCEDURE sp_mamba_dim_encounter_form()"));
		assertTrue(script.contains("CREATE PROCEDURE sp_mamba_dim_encounter_location()"));
		assertTrue(script.contains("CREATE PROCEDURE sp_mamba_dim_person_cpi()"));
		assertTrue(script.contains("CREATE PROCEDURE sp_mamba_data_processing_etl(IN etl_incremental_mode INT)"));
	}

	/**
	 * LE-363: the Liberia overrides replace core's procedures only because the script runs
	 * statements in order and ours come later. Each procedure's LAST definition must be ours.
	 */
	@Test
	public void deploysTheLiberiaOverrides_afterCoresOwnDefinitions() {
		assertLastDefinitionContains("sp_mamba_etl_incremental_columns_index_new_insert(",
		    "mamba_etl_liberia_incremental_state");
		assertLastDefinitionContains("sp_mamba_etl_incremental_columns_index_modified_insert(", "<=> t.");
		assertLastDefinitionContains("sp_mamba_dim_patient_identifier_incremental_update()",
		    "mpi.patient_identifier_id = im.incremental_table_pkey");
		assertLastDefinitionContains("sp_mamba_dim_encounter_insert()", "INSERT INTO mamba_dim_encounter");
		assertFalse("the deployed sp_mamba_dim_encounter_insert still filters by flat-table metadata",
		    lastDefinition("sp_mamba_dim_encounter_insert()").contains("mamba_concept_metadata"));
	}

	private static void assertLastDefinitionContains(String signature, String marker) {
		assertTrue("the deployed " + signature + " is core's, not the LE-363 override",
		    lastDefinition(signature).contains(marker));
	}

	private static String lastDefinition(String signature) {
		String create = "CREATE PROCEDURE " + signature;
		int start = script.lastIndexOf(create);
		assertTrue(create + " is not in the script", start >= 0);
		int end = script.indexOf("~-~-", start);
		return end < 0 ? script.substring(start) : script.substring(start, end);
	}

	@Test
	public void stillSchedulesTheEtl() {
		assertTrue(script.contains("CREATE EVENT IF NOT EXISTS _mamba_etl_scheduler_event"));
		assertTrue(script.contains("CALL sp_mamba_etl_setup(?, ?, ?, ?, ?, ?, ?)"));
	}
}
