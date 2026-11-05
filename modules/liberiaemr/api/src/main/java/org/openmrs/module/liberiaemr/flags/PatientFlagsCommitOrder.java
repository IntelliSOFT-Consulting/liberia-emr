/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.flags;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.api.ConditionService;
import org.openmrs.api.EncounterService;
import org.openmrs.api.ObsService;
import org.openmrs.api.OrderService;
import org.openmrs.api.PatientService;
import org.openmrs.api.ProgramWorkflowService;
import org.openmrs.api.context.Context;
import org.springframework.aop.Advisor;
import org.springframework.aop.framework.Advised;
import org.springframework.transaction.interceptor.TransactionInterceptor;

/**
 * patientflags 3.0.10 regenerates a patient's stored flags on a daemon thread started by its service
 * advice. Core appends module advice inside the service transaction, so that thread can read the
 * patient before the save commits and keep a flag the save resolved, such as TB Screening Not Done
 * (LE-614). Moving the advice just outside the transaction starts the thread after commit.
 */
public final class PatientFlagsCommitOrder {
	private static final Log log = LogFactory.getLog(PatientFlagsCommitOrder.class);
	static final String ADVICE_PACKAGE = "org.openmrs.module.patientflags.aop.";
	static final Class<?>[] SERVICES = { EncounterService.class, ObsService.class, OrderService.class,
	        PatientService.class, ConditionService.class, ProgramWorkflowService.class };

	private PatientFlagsCommitOrder() { }

	/** Core reloads module advice onto new proxies on every context refresh, so this runs on each. */
	public static void apply() {
		for (Class<?> service : SERVICES) {
			try {
				Object proxy = Context.getService(service);
				if (proxy instanceof Advised) { moveOutsideTransaction((Advised) proxy, ADVICE_PACKAGE); }
			}
			catch (RuntimeException e) {
				log.warn("Patient flags on " + service.getSimpleName() + " stay inside its transaction", e);
			}
		}
	}

	static void moveOutsideTransaction(Advised advised, String advicePackage) {
		for (Advisor advisor : advised.getAdvisors()) {
			if (!advisor.getAdvice().getClass().getName().startsWith(advicePackage)) { continue; }
			int transaction = transactionIndex(advised);
			if (transaction < 0 || advised.indexOf(advisor) < transaction) { continue; }
			advised.removeAdvisor(advisor);
			advised.addAdvisor(transaction, advisor);
		}
	}

	private static int transactionIndex(Advised advised) {
		Advisor[] advisors = advised.getAdvisors();
		for (int i = 0; i < advisors.length; i++) {
			if (advisors[i].getAdvice() instanceof TransactionInterceptor) { return i; }
		}
		return -1;
	}
}
