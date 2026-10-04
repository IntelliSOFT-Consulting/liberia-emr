/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reporting;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.manager.ReportManagerUtil;

/**
 * Saves every {@link LiberiaReportManager} under its fixed UUIDs, idempotently.
 * <p>
 * Runs on every module start, and always re-saves: reporting's own
 * {@code ReportManagerUtil.setupReport} skips a manager whose version is unchanged, which would
 * leave a changed SQL or ETL schema name unapplied. The definition is overwritten in place (its
 * report requests survive) and the designs are replaced under the same UUIDs, so a second run
 * leaves exactly what the first did.
 */
public class ReportRegistrar {
	
	private static final Log log = LogFactory.getLog(ReportRegistrar.class);
	
	/**
	 * Registers every manager in the Spring context. A manager that fails is logged and skipped, so one
	 * broken report never stops the module or the other reports.
	 * 
	 * @return how many were saved
	 */
	public int registerAll() {
		List<LiberiaReportManager> managers = Context.getRegisteredComponents(LiberiaReportManager.class);
		Map<ReportSheet, String> claimed = new EnumMap<ReportSheet, String>(ReportSheet.class);
		int saved = 0;
		for (LiberiaReportManager manager : managers) {
			String owner = claimed.put(manager.getSheet(), manager.getClass().getName());
			if (owner != null) {
				log.error("Two report managers claim sheet " + manager.getSheet() + ": " + owner + " and "
				        + manager.getClass().getName() + "; only the first is registered");
				continue;
			}
			try {
				register(manager);
				saved++;
			}
			catch (RuntimeException e) {
				log.error("Unable to register report " + manager.getName(), e);
			}
		}
		log.info("Registered " + saved + " LiberiaEMR indicator report(s)");
		return saved;
	}
	
	/**
	 * Saves one manager's definition and designs under its fixed UUIDs.
	 */
	public void register(LiberiaReportManager manager) {
		ReportDefinition definition = manager.constructReportDefinition();
		ReportManagerUtil.setupReportDefinition(definition, manager.constructReportDesigns(definition),
		    manager.constructScheduledRequests(definition));
		log.info("Registered report " + definition.getName() + " (" + definition.getUuid() + ")");
	}
}
