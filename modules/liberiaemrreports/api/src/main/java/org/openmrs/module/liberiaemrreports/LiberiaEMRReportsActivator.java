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

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.module.BaseModuleActivator;
import org.openmrs.module.liberiaemrreports.etl.EtlSchema;
import org.openmrs.module.liberiaemrreports.reporting.ReportRegistrar;
import org.openmrs.module.liberiaemrreports.scope.InstanceRole;

/**
 * Registers the indicator reports on every start. It never touches the ETL schema: a missing ETL
 * table fails a report run with a clear message and never stops this module (ADR 0010 decision 6).
 */
public class LiberiaEMRReportsActivator extends BaseModuleActivator {
	
	private static final Log log = LogFactory.getLog(LiberiaEMRReportsActivator.class);
	
	@Override
	public void started() {
		log.info("Starting LiberiaEMR Reports as a " + InstanceRole.current() + " instance over ETL schema "
		        + EtlSchema.getEtlDatabase());
		try {
			new ReportRegistrar().registerAll();
		}
		catch (RuntimeException e) {
			log.error("Unable to register the LiberiaEMR indicator reports", e);
		}
	}
	
	@Override
	public void stopped() {
		log.info("Stopped LiberiaEMR Reports");
	}
}
