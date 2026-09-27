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
