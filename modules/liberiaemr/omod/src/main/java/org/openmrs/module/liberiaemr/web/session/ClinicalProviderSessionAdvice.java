/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.session;

import java.util.Map;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.Provider;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.provider.ClinicalProviderAccount;
import org.openmrs.module.webservices.rest.web.ConversionUtil;
import org.openmrs.module.webservices.rest.web.representation.Representation;
import org.openmrs.module.webservices.rest.web.v1_0.controller.openmrs1_9.SessionController1_9;
import org.openmrs.util.PrivilegeConstants;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/**
 * Fills a null currentProvider in /ws/rest/v1/session for a user who can add encounters, creating
 * their Provider record first (LE-617). See {@link ClinicalProviderAccount}.
 * <p>
 * O3 reads the session on sign-in, so the record is made then, once. The provider is rendered as
 * the REST module renders it (REF, under a Get Providers proxy). Any failure leaves the body as the
 * REST module wrote it.
 * <p>
 * Not a UserService save hook on purpose: legacy UserFormController saves its own Provider after
 * createUser when "Create a Provider account" is ticked, without checking for an existing one, and
 * ProviderValidator accepts duplicate identifiers, so a save hook would give that user two providers.
 */
@ControllerAdvice(assignableTypes = SessionController1_9.class)
public class ClinicalProviderSessionAdvice implements ResponseBodyAdvice<Object> {

	private static final Log log = LogFactory.getLog(ClinicalProviderSessionAdvice.class);

	static final String CURRENT_PROVIDER = "currentProvider";

	@Override
	public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
		return true;
	}

	@Override
	@SuppressWarnings("unchecked")
	public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
	        Class<? extends HttpMessageConverter<?>> selectedConverterType, ServerHttpRequest request,
	        ServerHttpResponse response) {
		if (!lacksProvider(body)) {
			return body;
		}
		try {
			Provider provider = ClinicalProviderAccount.ensureForAuthenticatedUser();
			if (provider != null) {
				((Map<String, Object>) body).put(CURRENT_PROVIDER, render(provider));
			}
		}
		catch (RuntimeException e) {
			log.error("Could not create a provider for the signed-in user", e);
		}
		return body;
	}

	/** True for a session body whose currentProvider is present and null. */
	@SuppressWarnings("unchecked")
	static boolean lacksProvider(Object body) {
		return body instanceof Map && ((Map<String, Object>) body).containsKey(CURRENT_PROVIDER)
		        && ((Map<String, Object>) body).get(CURRENT_PROVIDER) == null;
	}

	private static Object render(Provider provider) {
		Context.addProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
		try {
			return ConversionUtil.convertToRepresentation(provider, Representation.REF);
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
		}
	}
}
