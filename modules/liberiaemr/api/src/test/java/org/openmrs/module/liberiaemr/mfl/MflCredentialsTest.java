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

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class MflCredentialsTest {

	// Not real credentials.
	private static final String FILE_VALUE = " from&file ";

	@Rule
	public TemporaryFolder folder = new TemporaryFolder();

	@Test
	public void fromEnvironment_shouldPreferThePasswordFileAndKeepItVerbatim() throws Exception {
		File file = folder.newFile("mfl-password");
		Files.write(file.toPath(), (FILE_VALUE + "\n").getBytes(StandardCharsets.UTF_8));
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflCredentials.ENV_USERNAME, "api-user");
		env.put(MflCredentials.ENV_PASSWORD_FILE, file.getAbsolutePath());
		env.put(MflCredentials.ENV_PASSWORD, "from-variable");
		MflCredentials credentials = MflCredentials.fromEnvironment(env);
		assertTrue(credentials.isAvailable());
		assertEquals(FILE_VALUE, credentials.getPassword());
	}

	@Test
	public void fromEnvironment_shouldFallBackToTheVariable() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflCredentials.ENV_USERNAME, "api-user");
		env.put(MflCredentials.ENV_PASSWORD, "from-variable");
		assertEquals("from-variable", MflCredentials.fromEnvironment(env).getPassword());
	}

	@Test
	public void fromEnvironment_shouldBeUnavailableWithoutBothParts() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflCredentials.ENV_USERNAME, "api-user");
		assertFalse(MflCredentials.fromEnvironment(env).isAvailable());
		env.clear();
		env.put(MflCredentials.ENV_PASSWORD, "from-variable");
		MflCredentials noUser = MflCredentials.fromEnvironment(env);
		assertFalse(noUser.isAvailable());
		assertNull(noUser.getUsername());
	}

	@Test
	public void fromEnvironment_shouldBeUnavailableWhenThePasswordFileCannotBeRead() {
		Map<String, String> env = new HashMap<String, String>();
		env.put(MflCredentials.ENV_USERNAME, "api-user");
		env.put(MflCredentials.ENV_PASSWORD_FILE, "/nonexistent/mfl-password");
		env.put(MflCredentials.ENV_PASSWORD, "from-variable");
		assertFalse("a broken file must not fall back silently", MflCredentials.fromEnvironment(env).isAvailable());
	}

	@Test
	public void toString_shouldNeverShowThePassword() {
		assertThat(new MflCredentials("api-user", "from-variable").toString(), not(containsString("from-variable")));
	}
}
