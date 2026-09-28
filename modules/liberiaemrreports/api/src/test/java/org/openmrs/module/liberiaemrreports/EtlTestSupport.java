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
	
	private EtlTestSupport() {
	}
	
	/**
	 * Creates the tables. Call BEFORE loading any data set: DDL commits the open transaction in H2.
	 */
	public static void createEtlTables(Connection connection) throws SQLException {
		Statement s = connection.createStatement();
		try {
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
			        + " encounter_datetime TIMESTAMP, voided BOOLEAN)");
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
			String t = "INSERT INTO " + SCHEMA + ".mamba_dim_location_hierarchy (location_id, name, parent_location_id,"
			        + " facility_location_id, district_location_id, county_location_id, tags) VALUES ";
			s.execute(t + "(101, 'Test County', NULL, NULL, NULL, 101, 'County')");
			s.execute(t + "(102, 'Test District', 101, NULL, 102, 101, 'District')");
			s.execute(t + "(103, 'Test Facility One', 102, 103, 102, 101, 'Health Facility')");
			s.execute(t + "(104, 'Test Facility One OPD', 103, 103, 102, 101, NULL)");
			s.execute(t + "(105, 'Test Facility Two', 102, 105, 102, 101, 'Health Facility')");
			// Closure rows, self included, as the ETL builds them.
			String a = "INSERT INTO " + SCHEMA + ".mamba_dim_location_ancestor (location_id, ancestor_location_id, depth) VALUES ";
			s.execute(a + "(101, 101, 0), (102, 102, 0), (102, 101, 1), (103, 103, 0), (103, 102, 1), (103, 101, 2),"
			        + " (104, 104, 0), (104, 103, 1), (104, 102, 2), (104, 101, 3), (105, 105, 0), (105, 102, 1), (105, 101, 2)");
			// The live encounters of LiberiaEMRReportsTestDataset.xml as the ETL flattens them: voided
			// 9006 is absent, and 9005 (no encounter location) takes its visit's location, 103.
			String e = "INSERT INTO " + SCHEMA + ".mamba_dim_encounter (encounter_id, encounter_datetime, voided) VALUES ";
			s.execute(e + "(9001, '2026-07-10 09:00:00', FALSE), (9002, '2026-08-01 09:00:00', FALSE),"
			        + " (9003, '2026-09-30 23:30:00', FALSE), (9004, '2026-07-01 00:00:00', FALSE),"
			        + " (9005, '2026-07-10 10:00:00', FALSE), (9007, '2025-12-31 09:00:00', FALSE)");
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
