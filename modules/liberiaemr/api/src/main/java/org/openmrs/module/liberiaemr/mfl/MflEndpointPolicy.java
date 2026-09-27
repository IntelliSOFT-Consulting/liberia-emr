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

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Where the MFL credentials may be sent. liberiaemr.mfl.url is editable over REST, so without this
 * a holder of Manage MFL Sync could point the sync at their own host and receive the MOH account.
 * The allowlist therefore comes from the deployment environment, never from a global property,
 * and is checked both when the URL is saved and before every request.
 */
public final class MflEndpointPolicy {

	/** Comma-separated host names; default dhis2.moh.gov.lr. */
	public static final String ENV_ALLOWED_HOSTS = "LIBERIAEMR_MFL_ALLOWED_HOSTS";

	/**
	 * "true" permits http:// to an allowed host. For a stub MFL in development and CI only; a real
	 * deployment never sets it, because the credentials would cross the network in clear.
	 */
	public static final String ENV_ALLOW_INSECURE_HTTP = "LIBERIAEMR_MFL_ALLOW_INSECURE_HTTP";

	public static final String DEFAULT_HOST = "dhis2.moh.gov.lr";

	private final Set<String> allowedHosts;

	private final boolean allowInsecureHttp;

	private MflEndpointPolicy(Set<String> allowedHosts, boolean allowInsecureHttp) {
		this.allowedHosts = Collections.unmodifiableSet(allowedHosts);
		this.allowInsecureHttp = allowInsecureHttp;
	}

	public static MflEndpointPolicy fromEnvironment(Map<String, String> env) {
		Set<String> hosts = new LinkedHashSet<String>();
		String configured = env.get(ENV_ALLOWED_HOSTS);
		if (configured != null) {
			for (String host : configured.split(",")) {
				if (!host.trim().isEmpty()) {
					hosts.add(host.trim().toLowerCase(Locale.ROOT));
				}
			}
		}
		if (hosts.isEmpty()) {
			hosts.add(DEFAULT_HOST);
		}
		return new MflEndpointPolicy(hosts, "true".equalsIgnoreCase(String.valueOf(env.get(ENV_ALLOW_INSECURE_HTTP)).trim()));
	}

	public static MflEndpointPolicy fromEnvironment() {
		return fromEnvironment(System.getenv());
	}

	public Set<String> getAllowedHosts() {
		return allowedHosts;
	}

	/**
	 * @param url the MFL instance root, or any URL the client is about to call
	 * @throws IllegalArgumentException with a message fit for an administrator when the URL is not
	 *             https:// (or allowed http://) on an allowed host, or carries user info
	 */
	public void check(String url) {
		URI uri;
		try {
			uri = new URI(url == null ? "" : url.trim());
		}
		catch (URISyntaxException e) {
			throw new IllegalArgumentException("The MFL URL is not a valid URL");
		}
		String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
		if (!"https".equals(scheme) && !(allowInsecureHttp && "http".equals(scheme))) {
			throw new IllegalArgumentException("The MFL URL must start with https://");
		}
		if (uri.getRawUserInfo() != null) {
			throw new IllegalArgumentException("The MFL URL must not carry a user name or password");
		}
		String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
		if (!allowedHosts.contains(host)) {
			throw new IllegalArgumentException("'" + host + "' is not an allowed MFL host. Allowed: " + allowedHosts
			        + ", set by " + ENV_ALLOWED_HOSTS + " in the deployment environment");
		}
	}
}
