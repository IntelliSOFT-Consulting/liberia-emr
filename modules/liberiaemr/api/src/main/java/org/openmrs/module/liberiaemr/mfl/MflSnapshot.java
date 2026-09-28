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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * One full pull of the MFL. It is complete only when every page arrived: the sync retires a
 * location for being absent only from a complete pull (ADR 0009 decision 5).
 */
public class MflSnapshot {

	private final List<MflUnit> units;

	private final List<String> failures;

	public MflSnapshot(List<MflUnit> units, List<String> failures) {
		this.units = Collections.unmodifiableList(new ArrayList<MflUnit>(units));
		this.failures = Collections.unmodifiableList(new ArrayList<String>(failures));
	}

	public List<MflUnit> getUnits() {
		return units;
	}

	/** One message per page that did not arrive. */
	public List<String> getFailures() {
		return failures;
	}

	public boolean isComplete() {
		return failures.isEmpty();
	}
}
