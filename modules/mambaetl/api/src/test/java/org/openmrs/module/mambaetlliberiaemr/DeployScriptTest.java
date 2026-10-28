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
	public void mchIptpDosesMapThroughEighth_andNationalThirdStaysThree() throws IOException {
		java.nio.file.Path root = java.nio.file.Paths.get("").toAbsolutePath();
		while (root != null && !java.nio.file.Files.isDirectory(root.resolve("content-packages"))) {
			root = root.getParent();
		}
		assertNotNull("content-packages not found from the module directory", root);
		java.util.Map<String, String> vars = new java.util.HashMap<String, String>();
		loadVars(vars, root.resolve(
		    "content-packages/content-liberia-mch/configuration/variables.properties"));
		loadVars(vars, root.resolve(
		    "content-packages/content-liberia-national/configuration/variables.properties"));
		assertMaps(vars, "var.concept.mch.1st-ipt-dose.uuid", 1);
		assertMaps(vars, "var.concept.mch.2nd-ipt-dose.uuid", 2);
		assertMaps(vars, "var.concept.mch.3rd-ipt-dose.uuid", 3);
		assertMaps(vars, "var.concept.mch.4th-ipt-dose.uuid", 4);
		assertMaps(vars, "var.concept.mch.5th-ipt-dose.uuid", 5);
		assertMaps(vars, "var.concept.mch.6th-ipt-dose.uuid", 6);
		assertMaps(vars, "var.concept.mch.7th-ipt-dose.uuid", 7);
		assertMaps(vars, "var.concept.mch.8th-ipt-dose.uuid", 8);
		assertMaps(vars, "var.concept.national.3rd-ipt-dose.uuid", 3);
		assertFalse(script.contains("${var.concept.mch.5th-ipt-dose.uuid}"));
		assertFalse(script.contains("${var.concept.mch.8th-ipt-dose.uuid}"));
	}

	private static void loadVars(java.util.Map<String, String> into, java.nio.file.Path file) throws IOException {
		for (String line : java.nio.file.Files.readAllLines(file, StandardCharsets.UTF_8)) {
			String trimmed = line.trim();
			if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains("=")) {
				continue;
			}
			int eq = trimmed.indexOf('=');
			into.put(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim());
		}
	}

	private static void assertMaps(java.util.Map<String, String> vars, String name, int dose) {
		String uuid = vars.get(name);
		assertNotNull(name, uuid);
		assertTrue(name + " does not map to " + dose + " in the compiled ANC fact",
		    script.contains("WHEN '" + uuid + "' THEN " + dose));
	}

	@Test
	public void mchIptpDosesMapThroughEighth_andNationalThirdPlusStaysThree() throws IOException {
		java.nio.file.Path repo = java.nio.file.Paths.get("").toAbsolutePath();
		while (repo != null && !java.nio.file.Files.isDirectory(repo.resolve("content-packages"))) {
			repo = repo.getParent();
		}
		assertNotNull("content-packages not found from the module directory", repo);
		java.util.Map<String, String> vars = new java.util.HashMap<String, String>();
		for (String line : java.nio.file.Files.readAllLines(repo.resolve(
		    "content-packages/content-liberia-mch/configuration/variables.properties"))) {
			String trimmed = line.trim();
			if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains("=")) {
				continue;
			}
			int eq = trimmed.indexOf('=');
			vars.put(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim());
		}
		for (String line : java.nio.file.Files.readAllLines(repo.resolve(
		    "content-packages/content-liberia-national/configuration/variables.properties"))) {
			String trimmed = line.trim();
			if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains("=")) {
				continue;
			}
			int eq = trimmed.indexOf('=');
			vars.put(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim());
		}
		String fact = lastDefinition("sp_mamba_fact_rmncah_anc_visit()");
		assertTrue(fact.contains("iptp_dose_number          TINYINT"));
		String[] mch = { "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th" };
		for (int dose = 1; dose <= mch.length; dose++) {
			String uuid = vars.get("var.concept.mch." + mch[dose - 1] + "-ipt-dose.uuid");
			assertTrue("compiled ETL missing MCH dose " + dose + " (" + uuid + ")",
			    fact.contains("WHEN '" + uuid + "' THEN " + dose));
		}
		assertTrue(fact.contains(
		    "WHEN '" + vars.get("var.concept.national.3rd-ipt-dose.uuid") + "' THEN 3"));
		assertFalse("national 3rd+ must stay dose 3",
		    fact.contains("WHEN '" + vars.get("var.concept.national.3rd-ipt-dose.uuid") + "' THEN 4"));
		assertFalse(fact.contains("${var.concept.mch.5th-ipt-dose.uuid}"));
		assertFalse(fact.contains("${var.concept.mch.8th-ipt-dose.uuid}"));
	}

	@Test
	public void vitaminAFactCountsEveryImmunizationFormVersion() {
		String fact = lastDefinition("sp_mamba_fact_nutrition_vitamin_a()");
		assertTrue(fact.contains("f.name = 'Immunization'"));
		assertTrue(fact.contains("f.version IN ('1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '1.11', '1.12', '1.13')"));
		assertTrue(fact.contains("0d652152-7780-3b5e-a3fe-f6921a5f795b"));
		assertTrue(fact.contains("'1.12'"));
		assertTrue(fact.contains("'1.11'"));
		assertFalse(fact.contains("ef.form_uuid = "));
	}

	@Test
	public void stillSchedulesTheEtl() {
		assertTrue(script.contains("CREATE EVENT IF NOT EXISTS _mamba_etl_scheduler_event"));
		assertTrue(script.contains("CALL sp_mamba_etl_setup(?, ?, ?, ?, ?, ?, ?)"));
	}
}
