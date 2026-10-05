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

import java.util.Properties;
import java.util.regex.Pattern;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.api.context.Context;

/**
 * Resolves the schema the Mamba ETL module flattens into, so that report SQL never names it.
 * <p>
 * The ETL module reads {@code mambaetl.analysis.db.etl_database} from the OpenMRS runtime
 * properties, which the openmrs-core image writes from
 * {@code OMRS_EXTRA_MAMBAETL_ANALYSIS_DB_ETL__DATABASE} (ADR 0010 decision 4). Reading the same
 * property keeps every report pointed at the schema the ETL actually built. Queries run over the
 * OpenMRS connection, which holds {@code SELECT} on that schema.
 * <p>
 * Report SQL writes the token {@value #TOKEN} wherever it needs the schema, before a table name;
 * {@link #qualify(String)} substitutes it.
 */
public final class EtlSchema {
	
	private static final Log log = LogFactory.getLog(EtlSchema.class);
	
	public static final String ETL_DATABASE_PROPERTY = "mambaetl.analysis.db.etl_database";
	
	/** The name every compose file sets (ADR 0010 decision 4), used when the property is unusable. */
	public static final String DEFAULT_ETL_DATABASE = "liberiaemr_etl";
	
	/** The token report SQL uses in place of the schema name. */
	public static final String TOKEN = "${etl}";
	
	/**
	 * The resolved name is spliced into SQL, so it must be a bare identifier. Stricter than MariaDB
	 * itself: no {@code $}, no quoting.
	 */
	private static final Pattern BARE_IDENTIFIER = Pattern.compile("\\w+");
	
	private EtlSchema() {
	}
	
	/**
	 * @return the configured ETL schema name, or {@link #DEFAULT_ETL_DATABASE} when it is unset or not
	 *         a bare identifier
	 */
	public static String getEtlDatabase() {
		return resolve(Context.getRuntimeProperties());
	}
	
	/**
	 * @param sql report SQL containing {@value #TOKEN}
	 * @return the SQL with every token replaced by the resolved schema name
	 */
	public static String qualify(String sql) {
		return qualify(sql, getEtlDatabase());
	}
	
	static String qualify(String sql, String schema) {
		return sql == null ? null : sql.replace(TOKEN, schema);
	}
	
	static String resolve(Properties runtimeProperties) {
		if (runtimeProperties == null) {
			return DEFAULT_ETL_DATABASE;
		}
		String configured = runtimeProperties.getProperty(ETL_DATABASE_PROPERTY);
		if (configured == null || configured.trim().isEmpty()) {
			return DEFAULT_ETL_DATABASE;
		}
		configured = configured.trim();
		if (!BARE_IDENTIFIER.matcher(configured).matches()) {
			log.warn("Ignoring " + ETL_DATABASE_PROPERTY + " because it is not a bare identifier; falling back to "
			        + DEFAULT_ETL_DATABASE);
			return DEFAULT_ETL_DATABASE;
		}
		return configured;
	}
}
