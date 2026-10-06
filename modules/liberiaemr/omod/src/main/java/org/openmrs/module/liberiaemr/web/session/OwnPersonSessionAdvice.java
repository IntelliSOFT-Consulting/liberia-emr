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

import java.util.LinkedHashMap;
import java.util.Map;

import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.webservices.rest.web.v1_0.controller.openmrs1_9.SessionController1_9;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/**
 * Puts the signed-in user's OWN person reference back into /ws/rest/v1/session when the REST module
 * left it out.
 * <p>
 * The REST module renders the session's user with person:(uuid,display), but drops the person when
 * the caller lacks Get People (ConversionUtil skips any object whose resource needs a privilege the
 * caller lacks). O3 then sends the user back to the login page, so without this every login role
 * would need Get People, which reads EVERY person's name, sex, birth date and address.
 * <p>
 * This adds exactly {uuid, display} of the authenticated user's own person, and only when the
 * rendered user is that user and has no person already. It grants no privilege: /person and every
 * other resource still answer 403 to a caller without Get People. Nothing else in the response is
 * touched. See docs/security/moh-ict-sop-mapping.md (B2).
 */
@ControllerAdvice(assignableTypes = SessionController1_9.class)
public class OwnPersonSessionAdvice implements ResponseBodyAdvice<Object> {

	@Override
	public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
		return true;
	}

	@Override
	public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
	        Class<? extends HttpMessageConverter<?>> selectedConverterType, ServerHttpRequest request,
	        ServerHttpResponse response) {
		addOwnPerson(body, Context.isAuthenticated() ? Context.getAuthenticatedUser() : null);
		return body;
	}

	/** Adds user.person = {uuid, display} of the given user when the body has a user without one. */
	@SuppressWarnings("unchecked")
	static void addOwnPerson(Object body, User authenticated) {
		if (authenticated == null || !(body instanceof Map)) {
			return;
		}
		Object user = ((Map<String, Object>) body).get("user");
		if (!(user instanceof Map)) {
			return;
		}
		Map<String, Object> rendered = (Map<String, Object>) user;
		Person person = authenticated.getPerson();
		// Only the signed-in user's own record, and only when the rendered user is that user.
		if (person == null || rendered.containsKey("person") || !authenticated.getUuid().equals(rendered.get("uuid"))) {
			return;
		}
		Map<String, Object> ref = new LinkedHashMap<String, Object>();
		ref.put("uuid", person.getUuid());
		PersonName name = person.getPersonName();
		ref.put("display", name == null ? null : name.getFullName());
		rendered.put("person", ref);
	}
}
