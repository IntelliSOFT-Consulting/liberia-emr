/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import org.openmrs.module.liberiaemrreports.etl.EtlSchema;

/**
 * A stand-in for the ETL schema the mambaetl module builds (RPT 5), in the test database: the
 * location hierarchy of {@code LiberiaEMRReportsTestDataset.xml} and an empty ETL schedule. The
 * column names follow {@code docs/reporting/README.md} §2.3 and core 3.0.0's
 * {@code sp_mamba_etl_schedule_table_create}.
 */
public final class EtlTestSupport {
	
	public static final String SCHEMA = EtlSchema.DEFAULT_ETL_DATABASE;

	/** Locations of LiberiaEMRReportsTestDataset.xml: ids 101 to 105. */
	public static final String COUNTY = "13cf7f2f-aa51-4daf-a895-adb964720986";

	public static final String DISTRICT = "ed8cc084-5cb5-46c2-bd13-58889ef22ffd";

	public static final String FACILITY_ONE = "c2a1f754-1594-491a-aff2-6d446c09900f";

	public static final String FACILITY_ONE_OPD = "ed80f7c1-dd08-4685-9afc-b18029365609";

	public static final String FACILITY_TWO = "9fcc83b6-2574-4f8e-ae92-724d7d5eeeb3";

	/**
	 * The dimension and fact tables the indicator reports read, with the columns they read, as
	 * {@code modules/mambaetl} builds them (types simplified for H2).
	 */
	static final String[] FACT_TABLES = {
	        "mamba_dim_person (person_id INT PRIMARY KEY, birthdate DATE, gender VARCHAR(50))",
	        "mamba_dim_person_cpi (person_id INT PRIMARY KEY, patient_uuid CHAR(38), primary_cpi_id INT,"
	                + " person_key VARCHAR(46) NOT NULL)",
	        "mamba_dim_emr_ops_encounter_type (encounter_type_id INT PRIMARY KEY, is_system_type INT NOT NULL)",
	        "mamba_fact_rmncah_family_planning (encounter_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " birthdate DATE, gender VARCHAR(50), encounter_datetime TIMESTAMP, location_id INT,"
	                + " facility_location_id INT, is_modern_method INT, protected_until DATE, method_removed_date DATE)",
	        "mamba_fact_rmncah_delivery (encounter_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " location_id INT, facility_location_id INT, is_episode_start INT, episode_start_datetime TIMESTAMP,"
	                + " episode_delivery_method VARCHAR(10))",
	        "mamba_fact_rmncah_mother_pnc (encounter_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " location_id INT, facility_location_id INT, is_episode_start INT, episode_start_datetime TIMESTAMP,"
	                + " episode_place_of_delivery VARCHAR(20))",
	        "mamba_fact_rmncah_anc_visit (encounter_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " encounter_datetime TIMESTAMP, location_id INT, facility_location_id INT, is_first_anc_contact INT,"
	                + " is_third_trimester INT, iptp_dose_number INT)",
	        "mamba_fact_nutrition_vitamin_a (event_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " event_datetime TIMESTAMP, location_id INT, facility_location_id INT, dose_iu INT, age_months INT)",
	        "mamba_fact_nutrition_anthropometry (encounter_id INT PRIMARY KEY, client_id INT, person_key VARCHAR(46),"
	                + " encounter_datetime TIMESTAMP, location_id INT, facility_location_id INT, age_months INT,"
	                + " muac_cm DECIMAL(5, 1), whz DECIMAL(5, 2))",
	        "mamba_fact_malaria_diagnosis (diagnosis_id INT PRIMARY KEY, encounter_id INT, visit_id INT, client_id INT,"
	                + " encounter_datetime TIMESTAMP, location_id INT, facility_location_id INT, icd10_category CHAR(3),"
	                + " icd10_group VARCHAR(20))",
	        "mamba_fact_malaria_drug (order_id INT PRIMARY KEY, visit_id INT, client_id INT, location_id INT,"
	                + " facility_location_id INT, is_pneumonia_antibiotic INT, is_oral_rehydration INT)",
	        "mamba_fact_malaria_lab_result (order_id INT, result_obs_id INT, client_id INT, location_id INT,"
	                + " facility_location_id INT, resulted_at TIMESTAMP, test_code VARCHAR(30), test_group VARCHAR(20),"
	                + " value_numeric DOUBLE, is_malaria_positive INT, PRIMARY KEY (order_id, result_obs_id))",
	        "mamba_fact_ncd_death (client_id INT PRIMARY KEY, death_date TIMESTAMP, age_years_at_death INT,"
	                + " cause_group VARCHAR(20), location_id INT, facility_location_id INT)",
	        "mamba_fact_ncd_blood_pressure (encounter_id INT PRIMARY KEY, client_id INT, encounter_datetime TIMESTAMP,"
	                + " location_id INT, facility_location_id INT, is_raised INT)",
	        "mamba_fact_emr_ops_visit (visit_id INT PRIMARY KEY, client_id INT, date_started TIMESTAMP,"
	                + " location_id INT, facility_location_id INT)",
	        "mamba_fact_emr_ops_patient (client_id INT PRIMARY KEY, person_key VARCHAR(46), date_registered TIMESTAMP,"
	                + " location_id INT, facility_location_id INT, hrn_consistent INT, is_probable_duplicate INT,"
	                + " same_facility_link INT, person_national_id_consistent INT)" };

	private EtlTestSupport() {
	}
	
	/**
	 * Creates the tables. Call BEFORE loading any data set: DDL commits the open transaction in H2.
	 */
	public static void createEtlTables(Connection connection) throws SQLException {
		Statement s = connection.createStatement();
		try {
			// A report's description carries its notes. Core's schema has VARCHAR(5000) here
			// (liquibase-schema-only-2.7.x.xml); the test database is generated at 255.
			s.execute("ALTER TABLE serialized_object ALTER COLUMN description VARCHAR(5000)");
			s.execute("CREATE SCHEMA IF NOT EXISTS " + SCHEMA);
			s.execute("DROP TABLE IF EXISTS " + SCHEMA + ".mamba_dim_location_hierarchy");
			s.execute("CREATE TABLE " + SCHEMA + ".mamba_dim_location_hierarchy (location_id INT PRIMARY KEY,"
			        + " uuid CHAR(38), name VARCHAR(255), parent_location_id INT, facility_location_id INT,"
			        + " district_location_id INT, county_location_id INT, tags VARCHAR(255))");
			s.execute("DROP TABLE IF EXISTS " + SCHEMA + ".mamba_dim_location_ancestor");
			s.execute("CREATE TABLE " + SCHEMA + ".mamba_dim_location_ancestor (location_id INT NOT NULL,"
			        + " ancestor_location_id INT NOT NULL, depth INT NOT NULL, PRIMARY KEY (location_id, ancestor_location_id))");
			s.execute("DROP TABLE IF EXISTS " + SCHEMA + ".mamba_dim_encounter");
			s.execute("CREATE TABLE " + SCHEMA + ".mamba_dim_encounter (encounter_id INT PRIMARY KEY,"
			        + " encounter_type INT, encounter_datetime TIMESTAMP, date_created TIMESTAMP, voided BOOLEAN)");
			for (String ddl : FACT_TABLES) {
				String table = ddl.substring(0, ddl.indexOf(' '));
				s.execute("DROP TABLE IF EXISTS " + SCHEMA + "." + table);
				s.execute("CREATE TABLE " + SCHEMA + "." + ddl);
			}
			s.execute("DROP TABLE IF EXISTS " + SCHEMA + ".mamba_dim_encounter_location");
			s.execute("CREATE TABLE " + SCHEMA + ".mamba_dim_encounter_location (encounter_id INT PRIMARY KEY,"
			        + " visit_id INT, encounter_location_id INT, visit_location_id INT, location_id INT NOT NULL)");
			s.execute("DROP TABLE IF EXISTS " + SCHEMA + "._mamba_etl_schedule");
			s.execute("CREATE TABLE " + SCHEMA + "._mamba_etl_schedule (id INT AUTO_INCREMENT PRIMARY KEY,"
			        + " start_time TIMESTAMP NOT NULL, end_time TIMESTAMP, next_schedule TIMESTAMP,"
			        + " execution_duration_seconds BIGINT, missed_schedule_by_seconds BIGINT,"
			        + " completion_status VARCHAR(10), transaction_status VARCHAR(10), success_or_error_message CLOB)");
		}
		finally {
			s.close();
		}
	}
	
	/** The hierarchy of the test data set: county 101, district 102, facilities 103 and 105. */
	public static void insertHierarchy(Connection connection) throws SQLException {
		Statement s = connection.createStatement();
		try {
			String t = "INSERT INTO " + SCHEMA + ".mamba_dim_location_hierarchy (location_id, uuid, name, parent_location_id,"
			        + " facility_location_id, district_location_id, county_location_id, tags) VALUES ";
			s.execute(t + "(101, '" + COUNTY + "', 'Test County', NULL, NULL, NULL, 101, 'County')");
			s.execute(t + "(102, '" + DISTRICT + "', 'Test District', 101, NULL, 102, 101, 'District')");
			s.execute(t + "(103, '" + FACILITY_ONE + "', 'Test Facility One', 102, 103, 102, 101, 'Health Facility')");
			s.execute(t + "(104, '" + FACILITY_ONE_OPD + "', 'Test Facility One OPD', 103, 103, 102, 101, NULL)");
			s.execute(t + "(105, '" + FACILITY_TWO + "', 'Test Facility Two', 102, 105, 102, 101, 'Health Facility')");
			// Closure rows, self included, as the ETL builds them.
			String a = "INSERT INTO " + SCHEMA + ".mamba_dim_location_ancestor (location_id, ancestor_location_id, depth) VALUES ";
			s.execute(a + "(101, 101, 0), (102, 102, 0), (102, 101, 1), (103, 103, 0), (103, 102, 1), (103, 101, 2),"
			        + " (104, 104, 0), (104, 103, 1), (104, 102, 2), (104, 101, 3), (105, 105, 0), (105, 102, 1), (105, 101, 2)");
			// The live encounters of LiberiaEMRReportsTestDataset.xml as the ETL flattens them: voided
			// 9006 is absent, and 9005 (no encounter location) takes its visit's location, 103.
			// All of type 1, a clinical type; 9002 was entered a day late.
			String e = "INSERT INTO " + SCHEMA + ".mamba_dim_encounter (encounter_id, encounter_type, encounter_datetime,"
			        + " date_created, voided) VALUES ";
			s.execute(e + "(9001, 1, '2026-07-10 09:00:00', '2026-07-10 09:00:00', FALSE),"
			        + " (9002, 1, '2026-08-01 09:00:00', '2026-08-02 08:00:00', FALSE),"
			        + " (9003, 1, '2026-09-30 23:30:00', '2026-09-30 23:30:00', FALSE),"
			        + " (9004, 1, '2026-07-01 00:00:00', '2026-07-01 00:00:00', FALSE),"
			        + " (9005, 1, '2026-07-10 10:00:00', '2026-07-10 10:00:00', FALSE),"
			        + " (9007, 1, '2025-12-31 09:00:00', '2025-12-31 09:00:00', FALSE)");
			s.execute("INSERT INTO " + SCHEMA + ".mamba_dim_emr_ops_encounter_type VALUES (1, 0), (2, 1)");
			String l = "INSERT INTO " + SCHEMA + ".mamba_dim_encounter_location (encounter_id, visit_id,"
			        + " encounter_location_id, visit_location_id, location_id) VALUES ";
			s.execute(l + "(9001, NULL, 104, NULL, 104), (9002, NULL, 104, NULL, 104), (9003, NULL, 103, NULL, 103),"
			        + " (9004, NULL, 105, NULL, 105), (9005, 9001, NULL, 103, 103), (9007, NULL, 103, NULL, 103)");
		}
		finally {
			s.close();
		}
	}
	
	public static void execute(Connection connection, String sql) throws SQLException {
		Statement s = connection.createStatement();
		try {
			s.execute(sql);
		}
		finally {
			s.close();
		}
	}
}
