/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

import org.openmrs.Patient;
import org.openmrs.api.context.Context;
import org.openmrs.module.ModuleFactory;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.patientflags.Flag;
import org.openmrs.module.patientflags.api.FlagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The ANC danger-sign patient flags (content-liberia-mch) that apply to a patient: the "key risk
 * flags" of the last ANC contact summary (ADR 0007). Evaluated by the patientflags module with the
 * content's own rules; empty when that module isn't running.
 */
final class AncRiskFlags {

	private static final Logger log = LoggerFactory.getLogger(AncRiskFlags.class);

	static final List<String> FLAG_VARIABLES = Arrays.asList("var.patientflag.anc-high-systolic-bp.uuid",
	    "var.patientflag.anc-high-diastolic-bp.uuid", "var.patientflag.anc-abnormal-fht.uuid",
	    "var.patientflag.anc-non-vertex-presentation.uuid");

	/** getFlagByUuid needs Test Flags; the SQL rules run through executeSQL. */
	private static final List<String> PRIVILEGES = Arrays.asList("Test Flags", "SQL Level Access");

	private AncRiskFlags() {
	}

	/** @return the names of the flags that apply, in content order */
	static List<String> evaluate(Patient patient) {
		if (patient == null || !ModuleFactory.isModuleStarted("patientflags")) {
			return Collections.emptyList();
		}
		for (String privilege : PRIVILEGES) {
			Context.addProxyPrivilege(privilege);
		}
		try {
			return Evaluator.names(patient);
		}
		catch (RuntimeException e) {
			log.warn("Could not evaluate ANC risk flags for {}: {}", patient.getUuid(), e.getMessage());
			return Collections.emptyList();
		}
		finally {
			for (String privilege : PRIVILEGES) {
				Context.removeProxyPrivilege(privilege);
			}
		}
	}

	/** Loaded only once the module is known to be running, so its classes are never needed otherwise. */
	private static final class Evaluator {

		static List<String> names(Patient patient) {
			FlagService flags = Context.getService(FlagService.class);
			List<String> names = new ArrayList<String>();
			for (String variable : FLAG_VARIABLES) {
				Flag flag = flags.getFlagByUuid(ContentUuids.get(variable));
				if (flag != null && Boolean.TRUE.equals(flag.getEnabled())
				        && Boolean.TRUE.equals(flag.eval(patient, new HashMap<Object, Object>()))) {
					names.add(flag.getName());
				}
			}
			return names;
		}
	}
}
