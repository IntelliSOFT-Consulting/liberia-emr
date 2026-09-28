/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

import java.io.File;
import java.sql.Connection;
import java.sql.SQLException;

import liquibase.Contexts;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.FileSystemResourceAccessor;

import org.hibernate.jdbc.Work;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;

/**
 * Applies the module's own liquibase.xml to the test database, so the run-history tests use the
 * real changesets rather than a copy of them. Module changesets are not run by the OpenMRS test
 * harness.
 */
final class MflSchema {
	
	private MflSchema() {
	}
	
	static void apply() {
		DbSessionFactory sessions = Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class);
		sessions.getCurrentSession().doWork(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try {
					Database database = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(
					    new JdbcConnection(connection));
					// appointments-api ships a liquibase.xml too, so read ours from this module's classes
					File classes = new File(MflSyncService.class.getProtectionDomain().getCodeSource().getLocation()
					        .toURI());
					new Liquibase("liquibase.xml", new FileSystemResourceAccessor(classes), database)
					        .update(new Contexts());
				}
				catch (Exception e) {
					throw new IllegalStateException("could not apply liquibase.xml to the test database", e);
				}
			}
		});
	}
}
