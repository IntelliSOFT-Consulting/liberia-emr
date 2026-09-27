/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.uuid;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;

import org.openmrs.api.APIException;

/**
 * Report and report-design UUIDs, read from {@value #RESOURCE}.
 * <p>
 * The file maps each {@code var.*} name to its {@code ${var.*}} token, and the api build filters it
 * from {@code content-liberia-national/configuration/variables.properties} (ADR 0010 decision 7).
 * Java therefore holds no UUID literal: a UUID is declared once, in content, and the same value
 * reaches the frontend config through the same variable.
 */
public final class ReportUuids {
	
	public static final String RESOURCE = "liberiaemrreports-uuids.properties";
	
	private static final Pattern UUID = Pattern
	        .compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
	
	private static volatile Properties loaded;
	
	private ReportUuids() {
	}
	
	/**
	 * @param variable the variable name as declared in content, e.g. {@code var.report.ncd.uuid}
	 * @return its UUID
	 * @throws APIException if the variable is missing or did not resolve to a UUID
	 */
	public static String get(String variable) {
		String value = properties().getProperty(variable);
		if (value == null) {
			throw new APIException(
			        variable + " is not in " + RESOURCE + "; add it there and to the national variables.properties");
		}
		value = value.trim();
		if (!UUID.matcher(value).matches()) {
			throw new APIException(
			        variable + " resolved to '" + value + "', which is not a UUID; the build did not filter " + RESOURCE);
		}
		return value;
	}
	
	/** @return every variable name the file declares */
	public static Set<String> variables() {
		Set<String> names = new HashSet<String>();
		for (Object key : properties().keySet()) {
			names.add(key.toString());
		}
		return Collections.unmodifiableSet(names);
	}
	
	private static Properties properties() {
		Properties p = loaded;
		if (p == null) {
			p = new Properties();
			InputStream in = ReportUuids.class.getClassLoader().getResourceAsStream(RESOURCE);
			if (in == null) {
				throw new APIException(RESOURCE + " is not on the classpath");
			}
			try {
				p.load(in);
			}
			catch (IOException e) {
				throw new APIException("Unable to read " + RESOURCE, e);
			}
			finally {
				try {
					in.close();
				}
				catch (IOException ignored) {
					// nothing to recover
				}
			}
			loaded = p;
		}
		return p;
	}
}
