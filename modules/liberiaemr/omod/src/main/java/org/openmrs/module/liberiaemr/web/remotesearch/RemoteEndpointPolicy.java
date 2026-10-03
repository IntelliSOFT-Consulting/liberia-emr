/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotesearch;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Where Remote Search may send the central service account and read patient records from. Same
 * model as the MFL sync's MflEndpointPolicy: the global property liberiaemr.remoteSearch.url is
 * editable over REST, so a URL that came from it is only used when its host is on an allowlist
 * that comes from the deployment environment. A URL set in the environment by the deployment
 * itself is trusted for its host, but must still be https://.
 */
final class RemoteEndpointPolicy {

	/** Comma-separated host names a URL from the global property may point at. Empty: none may. */
	static final String ENV_ALLOWED_HOSTS = "LIBERIAEMR_REMOTE_ALLOWED_HOSTS";

	/**
	 * "true" permits http:// to this machine's loopback interface, for a stub central in development
	 * and tests. It never permits http:// to any other host.
	 */
	static final String ENV_ALLOW_INSECURE_HTTP = "LIBERIAEMR_REMOTE_ALLOW_INSECURE_HTTP";

	private static final Set<String> LOOPBACK = new LinkedHashSet<String>(
	        Arrays.asList("localhost", "127.0.0.1", "[::1]", "::1"));

	private final Set<String> allowedHosts;

	private final boolean allowInsecureHttp;

	private RemoteEndpointPolicy(Set<String> allowedHosts, boolean allowInsecureHttp) {
		this.allowedHosts = Collections.unmodifiableSet(allowedHosts);
		this.allowInsecureHttp = allowInsecureHttp;
	}

	static RemoteEndpointPolicy fromEnvironment(Map<String, String> env) {
		Set<String> hosts = new LinkedHashSet<String>();
		String configured = env.get(ENV_ALLOWED_HOSTS);
		if (configured != null) {
			for (String host : configured.split(",")) {
				if (!host.trim().isEmpty()) {
					hosts.add(host.trim().toLowerCase(Locale.ROOT));
				}
			}
		}
		return new RemoteEndpointPolicy(hosts,
		        "true".equalsIgnoreCase(String.valueOf(env.get(ENV_ALLOW_INSECURE_HTTP)).trim()));
	}

	/**
	 * @param url the central instance root
	 * @param fromEnvironment true when the deployment set the URL itself (not the global property)
	 * @throws IllegalArgumentException with a message fit for the log when the URL may not be used
	 */
	void check(String url, boolean fromEnvironment) {
		URI uri;
		try {
			uri = new URI(url == null ? "" : url.trim());
		}
		catch (URISyntaxException e) {
			throw new IllegalArgumentException("The central URL is not a valid URL");
		}
		String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
		String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
		if (!"https".equals(scheme) && !(allowInsecureHttp && "http".equals(scheme) && LOOPBACK.contains(host))) {
			throw new IllegalArgumentException("The central URL must start with https://");
		}
		if (host.isEmpty()) {
			throw new IllegalArgumentException("The central URL has no host");
		}
		if (uri.getRawUserInfo() != null) {
			throw new IllegalArgumentException("The central URL must not carry a user name or password");
		}
		if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
			throw new IllegalArgumentException("The central URL is the instance root and must not carry a query or fragment");
		}
		if (!fromEnvironment && !allowedHosts.contains(host)) {
			throw new IllegalArgumentException("'" + host + "' is not an allowed central host for a URL set in the global "
			        + "property. Allowed: " + allowedHosts + ", set by " + ENV_ALLOWED_HOSTS
			        + " in the deployment environment; or set " + RemoteSearchService.ENV_REMOTE_URL + " instead");
		}
	}
}
