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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.User;
import org.openmrs.module.webservices.rest.SimpleObject;
import org.openmrs.module.webservices.rest.web.v1_0.controller.openmrs1_9.SessionController1_9;
import org.springframework.web.bind.annotation.ControllerAdvice;

public class OwnPersonSessionAdviceTest {

	private User user;

	private Person person;

	@Before
	public void setUp() {
		person = new Person();
		person.setUuid("person-uuid");
		person.addName(new PersonName("Grace", null, "Kollie"));
		user = new User(person);
		user.setUuid("user-uuid");
	}

	/** The session as the REST module renders it for a caller without Get People. */
	private static SimpleObject session(String userUuid) {
		SimpleObject rendered = new SimpleObject();
		rendered.add("uuid", userUuid);
		rendered.add("display", "gkollie");
		rendered.add("privileges", Arrays.asList());
		SimpleObject session = new SimpleObject();
		session.add("authenticated", true);
		session.add("user", rendered);
		return session;
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> userOf(Map<String, Object> session) {
		return (Map<String, Object>) session.get("user");
	}

	@Test
	public void addsTheSignedInUsersOwnPersonAsUuidAndDisplayOnly() {
		SimpleObject session = session("user-uuid");
		OwnPersonSessionAdvice.addOwnPerson(session, user);

		Map<String, Object> expected = new LinkedHashMap<String, Object>();
		expected.put("uuid", "person-uuid");
		expected.put("display", "Grace Kollie");
		assertEquals(expected, userOf(session).get("person"));
		// Nothing else is added or changed.
		assertEquals(Arrays.asList("uuid", "display", "privileges", "person"),
		    Arrays.asList(userOf(session).keySet().toArray()));
		assertEquals(Arrays.asList("authenticated", "user"), Arrays.asList(session.keySet().toArray()));
	}

	@Test
	public void leavesAPersonTheRestModuleRenderedAlone() {
		SimpleObject session = session("user-uuid");
		Object rendered = new SimpleObject().add("uuid", "person-uuid").add("display", "x").add("resourceVersion", "1.11");
		userOf(session).put("person", rendered);
		OwnPersonSessionAdvice.addOwnPerson(session, user);
		assertSame(rendered, userOf(session).get("person"));
	}

	@Test
	public void neverAddsAPersonToAUserOtherThanTheSignedInOne() {
		SimpleObject session = session("someone-else");
		OwnPersonSessionAdvice.addOwnPerson(session, user);
		assertFalse(userOf(session).containsKey("person"));
	}

	@Test
	public void addsNothingWithoutASignedInUser() {
		SimpleObject session = session("user-uuid");
		OwnPersonSessionAdvice.addOwnPerson(session, null);
		assertFalse(userOf(session).containsKey("person"));

		SimpleObject anonymous = new SimpleObject().add("authenticated", false);
		OwnPersonSessionAdvice.addOwnPerson(anonymous, user);
		assertEquals(Arrays.asList("authenticated"), Arrays.asList(anonymous.keySet().toArray()));
	}

	@Test
	public void addsNothingForAUserWithoutAPerson() {
		SimpleObject session = session("user-uuid");
		User daemon = new User();
		daemon.setUuid("user-uuid");
		OwnPersonSessionAdvice.addOwnPerson(session, daemon);
		assertFalse(userOf(session).containsKey("person"));
	}

	@Test
	public void ignoresBodiesThatAreNotASession() {
		OwnPersonSessionAdvice.addOwnPerson(null, user);
		OwnPersonSessionAdvice.addOwnPerson("text", user);
		SimpleObject odd = new SimpleObject().add("user", "not-a-map");
		OwnPersonSessionAdvice.addOwnPerson(odd, user);
		assertEquals("not-a-map", odd.get("user"));
	}

	@Test
	public void appliesToTheSessionControllerOnly() {
		ControllerAdvice advice = OwnPersonSessionAdvice.class.getAnnotation(ControllerAdvice.class);
		assertEquals(Arrays.asList(SessionController1_9.class), Arrays.asList(advice.assignableTypes()));
		assertEquals(0, advice.basePackages().length);
		assertEquals(0, advice.value().length);
		assertEquals(0, advice.annotations().length);
		assertEquals(0, advice.basePackageClasses().length);
	}
}
