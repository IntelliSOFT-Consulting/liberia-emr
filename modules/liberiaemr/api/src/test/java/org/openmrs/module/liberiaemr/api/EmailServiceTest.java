/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.api;

import java.io.File;
import java.nio.charset.Charset;
import java.nio.file.Files;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import static org.junit.Assert.assertEquals;

/**
 * Covers how the SMTP credential is read from a file. The file path exists so a deployment can
 * hand the module a secret without it ever appearing in versioned content, in a global property,
 * or in a value some substitution tool has interpreted on the way through.
 */
public class EmailServiceTest {
	
	@Rule
	public TemporaryFolder tmp = new TemporaryFolder();
	
	private String write(String contents) throws Exception {
		File f = tmp.newFile();
		Files.write(f.toPath(), contents.getBytes(Charset.forName("UTF-8")));
		return f.getAbsolutePath();
	}
	
	@Test
	public void readSecretFile_shouldReadTheSecretVerbatim() throws Exception {
		assertEquals("s3cr3t", EmailService.readSecretFile(write("s3cr3t")));
	}
	
	/**
	 * `echo secret > file` is how these files get written, so one trailing newline is noise.
	 */
	@Test
	public void readSecretFile_shouldStripOneTrailingNewline() throws Exception {
		assertEquals("s3cr3t", EmailService.readSecretFile(write("s3cr3t\n")));
		assertEquals("s3cr3t", EmailService.readSecretFile(write("s3cr3t\r\n")));
	}
	
	/**
	 * Everything else is part of the password. An app password from Google is printed in
	 * spaced groups of four, and a relay may well have been configured with the spaces in.
	 */
	@Test
	public void readSecretFile_shouldPreserveSpacesAndSpecialCharacters() throws Exception {
		assertEquals(" abcd efgh ijkl mnop ", EmailService.readSecretFile(write(" abcd efgh ijkl mnop \n")));
		assertEquals("p@$$:w%rd\\'\"`$(x)", EmailService.readSecretFile(write("p@$$:w%rd\\'\"`$(x)")));
	}
	
	@Test
	public void readSecretFile_shouldKeepInteriorNewlines() throws Exception {
		assertEquals("one\ntwo", EmailService.readSecretFile(write("one\ntwo\n")));
	}
	
	/**
	 * An unreadable file must not take the request down, and must not quietly become some
	 * other credential either — it authenticates with nothing and the error names the path.
	 */
	@Test
	public void readSecretFile_shouldReturnEmptyWhenTheFileIsMissing() {
		assertEquals("", EmailService.readSecretFile("/nonexistent/liberiaemr-smtp-password"));
	}
	
	@Test
	public void readSecretFile_shouldReturnEmptyForAnEmptyFile() throws Exception {
		assertEquals("", EmailService.readSecretFile(write("")));
	}
}
