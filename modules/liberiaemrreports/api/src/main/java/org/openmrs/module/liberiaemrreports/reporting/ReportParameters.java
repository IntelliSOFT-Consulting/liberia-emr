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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;

import org.openmrs.Location;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;

/**
 * The three parameters every indicator report takes, with the exact names of
 * {@code docs/reporting/README.md} §3.2. The UI and reportingrest's {@code parameterMappings} use
 * these names, so they never change.
 */
// java.util.Date, not java.time: reporting's Parameter, the UI's date pickers and reportingrest all
// type dates as Date. SonarQube's java:S2143 is excluded for this file in the root pom.
public final class ReportParameters {
	
	/** Inclusive, from 00:00. */
	public static final String START_DATE = "startDate";
	
	/** Inclusive, to 23:59:59. */
	public static final String END_DATE = "endDate";
	
	/** Optional; see {@link org.openmrs.module.liberiaemrreports.scope.LocationScopeResolver}. */
	public static final String LOCATION = "location";
	
	private ReportParameters() {
	}
	
	public static Parameter startDate() {
		return new Parameter(START_DATE, "Start Date", Date.class);
	}
	
	public static Parameter endDate() {
		return new Parameter(END_DATE, "End Date", Date.class);
	}
	
	public static Parameter locationParameter() {
		Parameter p = new Parameter(LOCATION, "Location", Location.class);
		p.setRequired(false);
		return p;
	}
	
	/** @return fresh instances of all three, in UI order */
	public static List<Parameter> all() {
		// A real ArrayList: the definition is serialised with XStream, which cannot reflect into
		// Arrays$ArrayList on Java 17 without --add-opens.
		return new ArrayList<Parameter>(Arrays.asList(startDate(), endDate(), locationParameter()));
	}
}
