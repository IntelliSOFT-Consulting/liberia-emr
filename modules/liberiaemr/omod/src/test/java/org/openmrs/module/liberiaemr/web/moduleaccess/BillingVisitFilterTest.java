/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.moduleaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import javax.servlet.FilterChain;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import org.junit.Test;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.BillingVisitAccess;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/**
 * Manage Cashier Metadata is a call proxy for an authenticated billing writer. A caller without
 * billing write never receives it, and a privilege this filter did not add is left in place.
 */
public class BillingVisitFilterTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";
	private static final String META = BillingVisitFilter.MANAGE_CASHIER_METADATA;
	private static final String[] BILLING = { "View Cashier Bills", "Manage Cashier Bills", "View Cashier Metadata" };

	@Test public void nurseBillPostDoesNotReceiveManageCashierMetadata() throws Exception {
		as("Nurse", "Manage Pharmacy");
		Observation chain = post();
		assertFalse("downstream chain", chain.saw);
		assertFalse("after the call", Context.hasPrivilege(META));
		assertFalse("on the role", Context.getAuthenticatedUser().hasPrivilege(META));
		assertFalse(BillingVisitAccess.openNow());
	}

	@Test public void billingWritersReceiveTheProxyOnlyDuringBillPost() throws Exception {
		for (String role : new String[] { "Finance", "Systems Administrator", "Facility in-charge" }) {
			assertWriter(role);
		}
	}

	@Test public void anExistingPrivilegeIsNotRemoved() throws Exception {
		as("Finance", concat(BILLING, META));
		assertTrue(Context.getAuthenticatedUser().hasPrivilege(META));
		Observation chain = post();
		assertTrue("downstream chain", chain.saw);
		assertTrue("role grant remains after the call", Context.getAuthenticatedUser().hasPrivilege(META));
		assertTrue("still held after the call", Context.hasPrivilege(META));

		as("Facility in-charge", BILLING);
		assertFalse(Context.getAuthenticatedUser().hasPrivilege(META));
		Context.addProxyPrivilege(META);
		try {
			Observation proxy = post();
			assertTrue("downstream chain sees the privilege this filter did not add", proxy.saw);
			assertFalse("not copied onto the role", Context.getAuthenticatedUser().hasPrivilege(META));
			assertTrue("pre-existing proxy survives the filter", Context.hasPrivilege(META));
		}
		finally {
			if (Context.hasPrivilege(META) && !Context.getAuthenticatedUser().hasPrivilege(META)) {
				Context.removeProxyPrivilege(META);
			}
		}
		assertFalse(Context.hasPrivilege(META));
		assertFalse(BillingVisitAccess.openNow());
	}

	@Test public void unauthenticatedCallerReceivesNoTemporaryPrivilege() throws Exception {
		Context.logout();
		try {
			assertFalse(Context.isAuthenticated());
			Observation chain = post();
			assertFalse("downstream chain", chain.saw);
			assertFalse("after the call", Context.hasPrivilege(META));
		}
		finally {
			Context.authenticate("admin", "test");
		}
		assertFalse(BillingVisitAccess.openNow());
	}

	@Test public void proxyIsRemovedWhenTheChainThrows() throws Exception {
		as("Finance", BILLING);
		Observation chain = new Observation();
		chain.failure = new RuntimeException("bill failed");
		try {
			new BillingVisitFilter().doFilter(billPost(), null, chain);
			fail("chain should have thrown");
		}
		catch (RuntimeException e) {
			assertEquals("bill failed", e.getMessage());
		}
		assertTrue("downstream chain", chain.saw);
		assertFalse("not on the role", Context.getAuthenticatedUser().hasPrivilege(META));
		assertFalse("removed after the exception", Context.hasPrivilege(META));
		assertFalse(BillingVisitAccess.openNow());
	}

	private void assertWriter(String role) throws Exception {
		as(role, BILLING);
		assertFalse(Context.hasPrivilege(META));
		assertFalse(Context.getAuthenticatedUser().hasPrivilege(META));
		Observation chain = post();
		assertTrue(role + " downstream chain", chain.saw);
		assertFalse(role + " was not granted on the role", chain.ownedByRole);
		assertFalse(role + " after the call", Context.hasPrivilege(META));
		assertFalse(role + " role after the call", Context.getAuthenticatedUser().hasPrivilege(META));
		assertFalse(BillingVisitAccess.openNow());
	}

	private static Observation post() throws Exception {
		Observation chain = new Observation();
		new BillingVisitFilter().doFilter(billPost(), null, chain);
		return chain;
	}

	private static HttpServletRequest billPost() {
		return (HttpServletRequest) Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(),
		    new Class<?>[] { HttpServletRequest.class }, new InvocationHandler() {
			    public Object invoke(Object proxy, Method method, Object[] args) {
				    if ("getMethod".equals(method.getName())) { return "POST"; }
				    if ("getRequestURI".equals(method.getName())) { return "/openmrs/ws/rest/v1/billing/bill"; }
				    if ("hashCode".equals(method.getName())) { return System.identityHashCode(proxy); }
				    if ("equals".equals(method.getName())) { return proxy == args[0]; }
				    if ("toString".equals(method.getName())) { return "bill POST"; }
				    Class<?> type = method.getReturnType();
				    if (type == boolean.class) { return Boolean.FALSE; }
				    if (type == int.class) { return Integer.valueOf(0); }
				    if (type == long.class) { return Long.valueOf(0); }
				    return null;
			    }
		    });
	}

	private static final class Observation implements FilterChain {
		private boolean saw;
		private boolean ownedByRole;
		private RuntimeException failure;

		public void doFilter(ServletRequest request, ServletResponse response) {
			saw = Context.hasPrivilege(META);
			ownedByRole = Context.isAuthenticated() && Context.getAuthenticatedUser().hasPrivilege(META);
			if (failure != null) { throw failure; }
		}
	}

	private static String[] concat(String[] first, String extra) {
		String[] all = java.util.Arrays.copyOf(first, first.length + 1);
		all[first.length] = extra;
		return all;
	}

	private void as(String roleName, String... privileges) throws Exception {
		Context.authenticate("admin", "test");
		Role role = Context.getUserService().getRole(roleName);
		if (role == null) {
			role = new Role(roleName);
			role.setDescription(roleName);
		}
		for (String name : privileges) {
			Privilege privilege = Context.getUserService().getPrivilege(name);
			if (privilege == null) {
				privilege = Context.getUserService().savePrivilege(new Privilege(name, name));
			}
			role.addPrivilege(privilege);
		}
		role = Context.getUserService().saveRole(role);
		Person person = new Person();
		person.addName(new PersonName(roleName, null, "User"));
		person.setGender("F");
		person = Context.getPersonService().savePerson(person);
		User user = new User();
		user.setUsername(roleName.toLowerCase().replace(' ', '-') + "-" + System.nanoTime());
		user.setPerson(person);
		user.addRole(role);
		user = Context.getUserService().createUser(user, PASSWORD);
		Context.authenticate(user.getUsername(), PASSWORD);
	}
}
