/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

/**
 * Content UUIDs, read from {@value #RESOURCE}.
 * <p>
 * The file maps each {@code var.*} name to its {@code ${var.*}} token, and the api build filters it
 * from {@code content-liberia-national/configuration/variables.properties} (ADR 0010 decision 7,
 * the pattern of liberiaemrreports' {@code ReportUuids}). Java therefore holds no UUID literal: a
 * UUID is declared once, in content, and the ETL and Initializer read the same variable.
 */
public final class ContentUuids {

	public static final String RESOURCE = "liberiaemr-uuids.properties";

	/** The {@code Health Facility} location tag (content-liberia-national locationtags-national.csv). */
	public static final String LOCATION_TAG_HEALTH_FACILITY = "var.locationtag.health-facility.uuid";

	private static final Pattern UUID = Pattern
	        .compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

	private static final AtomicReference<Properties> LOADED = new AtomicReference<Properties>();

	private ContentUuids() {
	}

	/**
	 * @param variable the variable name as declared in content, e.g.
	 *            {@code var.locationtag.health-facility.uuid}
	 * @return its UUID
	 * @throws IllegalStateException if the variable is missing or did not resolve to a UUID
	 */
	public static String get(String variable) {
		String value = properties().getProperty(variable);
		if (value == null) {
			throw new IllegalStateException(
			        variable + " is not in " + RESOURCE + "; add it there and to the national variables.properties");
		}
		value = value.trim();
		if (!UUID.matcher(value).matches()) {
			throw new IllegalStateException(
			        variable + " resolved to '" + value + "', which is not a UUID; the build did not filter " + RESOURCE);
		}
		return value;
	}

	private static Properties properties() {
		Properties p = LOADED.get();
		if (p != null) {
			return p;
		}
		p = new Properties();
		InputStream in = ContentUuids.class.getClassLoader().getResourceAsStream(RESOURCE);
		if (in == null) {
			throw new IllegalStateException(RESOURCE + " is not on the classpath");
		}
		try {
			p.load(in);
		}
		catch (IOException e) {
			throw new IllegalStateException("Unable to read " + RESOURCE, e);
		}
		finally {
			try {
				in.close();
			}
			catch (IOException ignored) {
				// nothing to recover
			}
		}
		// Two threads may both load it the first time; the file is identical, so either wins.
		LOADED.compareAndSet(null, p);
		return LOADED.get();
	}
}
