/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.moduleaccess;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.Test;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessInstaller.PharmacyFhirRead;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.util.PrivilegeConstants;

/** A pharmacy read proxies Get Orders for that call. It does not grant Get Encounters or keep the proxy. */
public class PharmacyFhirReadTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";

	@Test public void pharmacyWritersReceiveGetOrdersOnlyForTheRead() throws Throwable {
		PharmacyFhirRead orders = new PharmacyFhirRead(PrivilegeConstants.GET_ORDERS);
		for (String role : new String[] { "Pharmacist", "Nurse", "Midwife", "Physician Assistant", "Systems Administrator",
		        "Facility in-charge" }) {
			as(role, "Manage Pharmacy");
			orders.invoke(during(new Runnable() {
				public void run() {
					assertTrue(Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
					assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ENCOUNTERS));
				}
			}));
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_ENCOUNTERS));
		}
	}

	@Test public void anExistingGetOrdersPrivilegeIsNotRemoved() throws Throwable {
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.GET_ORDERS);
		new PharmacyFhirRead(PrivilegeConstants.GET_ORDERS).invoke(during(new Runnable() {
			public void run() { assertTrue(Context.hasPrivilege(PrivilegeConstants.GET_ORDERS)); }
		}));
		assertTrue(Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
	}

	@Test public void laboratoryRegistrarAndFinanceAreNotGivenPharmacyReads() throws Throwable {
		PharmacyFhirRead orders = new PharmacyFhirRead(PrivilegeConstants.GET_ORDERS);
		PharmacyFhirRead dispenses = new PharmacyFhirRead(PrivilegeConstants.GET_MEDICATION_DISPENSE);
		for (String role : new String[] { "Lab Technician", "Registrar", "Finance" }) {
			as(role, "Manage Laboratory");
			orders.invoke(during(new Runnable() {
				public void run() { assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ORDERS)); }
			}));
			dispenses.invoke(during(new Runnable() {
				public void run() { assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_MEDICATION_DISPENSE)); }
			}));
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_MEDICATION_DISPENSE));
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_ENCOUNTERS));
		}
	}

	@Test public void privilegeIsRemovedWhenTheReadThrows() throws Throwable {
		as("Nurse", "Manage Pharmacy");
		try {
			new PharmacyFhirRead(PrivilegeConstants.GET_ORDERS).invoke(new MethodInvocation() {
				public Method getMethod() { return method(); }
				public Object[] getArguments() { return new Object[0]; }
				public Object proceed() { throw new RuntimeException("search failed"); }
				public Object getThis() { return null; }
				public AccessibleObject getStaticPart() { return getMethod(); }
			});
		}
		catch (RuntimeException e) {
			assertTrue(e.getMessage().contains("search failed"));
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
	}

	private static MethodInvocation during(final Runnable check) {
		return new MethodInvocation() {
			public Method getMethod() { return method(); }
			public Object[] getArguments() { return new Object[0]; }
			public Object proceed() { check.run(); return null; }
			public Object getThis() { return null; }
			public AccessibleObject getStaticPart() { return getMethod(); }
		};
	}

	private static Method method() {
		try { return Object.class.getMethod("toString"); }
		catch (NoSuchMethodException e) { throw new IllegalStateException(e); }
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
		Context.authenticate(Context.getUserService().createUser(user, PASSWORD).getUsername(), PASSWORD);
	}
}
