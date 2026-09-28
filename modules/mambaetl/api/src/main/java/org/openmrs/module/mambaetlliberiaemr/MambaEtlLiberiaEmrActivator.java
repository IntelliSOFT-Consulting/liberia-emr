/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 */
package org.openmrs.module.mambaetlliberiaemr;

import org.openmrs.api.context.Context;
import org.openmrs.module.BaseModuleActivator;
import org.openmrs.module.mambacore.api.FlattenDatabaseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deploys the ETL on start and stops its deploy thread on stop (ADR 0010 decision 1).
 * <p>
 * {@link FlattenDatabaseService#setupEtl()} returns at once: core runs the deploy script
 * (mamba/jdbc_create_stored_procedures.sql, compiled into this module's api jar) on a thread of
 * its own and only LOGS a failure, as "Failed to deploy MambaETL". A failed deploy therefore
 * never stops OpenMRS starting; check the log and {@code _mamba_etl_error_log}.
 * <p>
 * The service bean comes from mamba-core-api's own moduleApplicationContext.xml, which this
 * module bundles in lib/.
 */
public class MambaEtlLiberiaEmrActivator extends BaseModuleActivator {

	private static final Logger log = LoggerFactory.getLogger(MambaEtlLiberiaEmrActivator.class);

	@Override
	public void started() {
		log.info("Starting LiberiaEMR MambaETL: deploying the ETL schema and scheduler");
		Context.getService(FlattenDatabaseService.class).setupEtl();
	}

	@Override
	public void stopped() {
		log.info("Stopping LiberiaEMR MambaETL");
		Context.getService(FlattenDatabaseService.class).shutdownEtlThread();
	}
}
