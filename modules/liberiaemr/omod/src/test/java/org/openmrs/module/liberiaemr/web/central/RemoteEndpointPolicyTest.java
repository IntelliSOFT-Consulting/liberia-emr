/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.central;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class RemoteEndpointPolicyTest {

	private static RemoteEndpointPolicy policy(String allowedHosts, String insecure) {
		Map<String, String> env = new HashMap<String, String>();
		if (allowedHosts != null) {
			env.put(RemoteEndpointPolicy.ENV_ALLOWED_HOSTS, allowedHosts);
		}
		if (insecure != null) {
			env.put(RemoteEndpointPolicy.ENV_ALLOW_INSECURE_HTTP, insecure);
		}
		return RemoteEndpointPolicy.fromEnvironment(env);
	}

	private static void rejects(RemoteEndpointPolicy policy, String url, boolean fromEnvironment) {
		try {
			policy.check(url, fromEnvironment);
			fail(url + " should have been refused");
		}
		catch (IllegalArgumentException expected) {
			assertTrue(expected.getMessage().length() > 0);
		}
	}

	@Test
	public void aDeploymentSuppliedHttpsUrlIsTrustedForItsHost() {
		policy(null, null).check("https://central.moh.gov.lr", true);
		policy(null, null).check("https://central.moh.gov.lr/openmrs", true);
	}

	@Test
	public void aGlobalPropertyUrlNeedsAnAllowedHost() {
		RemoteEndpointPolicy allowed = policy("Central.moh.gov.lr, other.moh.gov.lr", null);

		allowed.check("https://central.moh.gov.lr", false);
		rejects(allowed, "https://attacker.example", false);
		// Nothing allowed by default, so the global property alone can never aim the credentials.
		rejects(policy(null, null), "https://central.moh.gov.lr", false);
	}

	@Test
	public void plainHttpIsRefusedEvenFromTheEnvironment() {
		rejects(policy("attacker.example", null), "http://attacker.example", true);
		rejects(policy("attacker.example", null), "http://attacker.example", false);
		rejects(policy("attacker.example", "true"), "http://attacker.example", false);
	}

	@Test
	public void httpIsOnlyAllowedToLoopbackWhenSwitchedOn() {
		policy(null, "true").check("http://127.0.0.1:8080", true);
		policy(null, "true").check("http://localhost:8080/openmrs", true);
		rejects(policy(null, null), "http://127.0.0.1:8080", true);
	}

	@Test
	public void userInfoQueryFragmentAndGarbageAreRefused() {
		RemoteEndpointPolicy p = policy("central.moh.gov.lr", null);

		rejects(p, "https://user:pw@central.moh.gov.lr", true);
		rejects(p, "https://central.moh.gov.lr?x=1", true);
		rejects(p, "https://central.moh.gov.lr#frag", true);
		rejects(p, "not a url", true);
		rejects(p, "", true);
		rejects(p, "ftp://central.moh.gov.lr", true);
	}
}
