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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import java.util.Date;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.Patient;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.Visit;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.util.PrivilegeConstants;

/** Bill save may look up one patient's visit. It may not list visits, and the privilege does not survive. */
public class BillingVisitAccessTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";
	private static final String[] BILLING = { "View Cashier Bills", "Manage Cashier Bills", "View Cashier Metadata" };
	private Visit visit;

	@Before public void visits() {
		ModuleAccessInstaller.install();
		visit = new Visit();
		visit.setPatient(Context.getPatientService().getPatient(2));
		visit.setVisitType(Context.getVisitService().getVisitType(1));
		visit.setStartDatetime(new Date());
		visit.setLocation(Context.getLocationService().getLocation(1));
		visit = Context.getVisitService().saveVisit(visit);
	}

	@Test public void financeCanLookUpTheActiveVisitAndASuppliedVisitOnlyDuringBillSave() throws Exception {
		as("Finance", BILLING);
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
		denied("ordinary active visits", new Runnable() {
			public void run() { Context.getVisitService().getActiveVisitsByPatient(visit.getPatient()); }
		});
		denied("ordinary visit", new Runnable() {
			public void run() { Context.getVisitService().getVisit(visit.getVisitId()); }
		});
		BillingVisitAccess.open();
		try {
			assertNotNull(Context.getVisitService().getActiveVisitsByPatient(visit.getPatient()));
			assertEquals(visit.getVisitId(), Context.getVisitService().getVisit(visit.getVisitId()).getVisitId());
			assertEquals(visit.getUuid(), Context.getVisitService().getVisitByUuid(visit.getUuid()).getUuid());
			denied("visit listing", new Runnable() {
				public void run() { Context.getVisitService().getAllVisits(); }
			});
		}
		finally {
			BillingVisitAccess.close();
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
		denied("after bill save", new Runnable() {
			public void run() { Context.getVisitService().getVisit(visit.getVisitId()); }
		});
	}

	@Test public void laboratoryCanResolveOneOrdererAndCannotListProviders() throws Exception {
		String providerUuid = Context.getProviderService().getAllProviders().get(0).getUuid();
		as("Lab Technician", new String[] { "Manage Laboratory" });
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS));
		assertNotNull(Context.getProviderService().getProviderByUuid(providerUuid));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS));
		denied("provider listing", new Runnable() {
			public void run() { Context.getProviderService().getAllProviders(); }
		});
	}

	@Test public void financeCanResolveTheCashierOnlyDuringBillSave() throws Exception {
		as("Finance", BILLING);
		Person person = Context.getAuthenticatedUser().getPerson();
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS));
		denied("ordinary providers for person", new Runnable() {
			public void run() { Context.getProviderService().getProvidersByPerson(person); }
		});
		BillingVisitAccess.open();
		try {
			assertNotNull(Context.getProviderService().getProvidersByPerson(person));
			denied("provider listing", new Runnable() {
				public void run() { Context.getProviderService().getAllProviders(); }
			});
		}
		finally {
			BillingVisitAccess.close();
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_PROVIDERS));
	}

	@Test public void viewMetadataReadsACashPointAndCannotSaveOne() throws Throwable {
		as("Finance", BILLING);
		assertFalse(Context.hasPrivilege(BillingMetadataAccess.MANAGE_CASHIER_METADATA));
		BillingMetadataAccess access = new BillingMetadataAccess();
		assertEquals(Boolean.TRUE, access.invoke(named("getCashPointByUuid", new Runnable() {
			public void run() {
				if (!Context.hasPrivilege(BillingMetadataAccess.MANAGE_CASHIER_METADATA)) {
					throw new org.openmrs.api.APIAuthenticationException("Manage Cashier Metadata");
				}
			}
		})));
		assertFalse(Context.hasPrivilege(BillingMetadataAccess.MANAGE_CASHIER_METADATA));
		try {
			access.invoke(named("saveCashPoint", new Runnable() {
				public void run() {
					if (!Context.hasPrivilege(BillingMetadataAccess.MANAGE_CASHIER_METADATA)) {
						throw new org.openmrs.api.APIAuthenticationException("Manage Cashier Metadata");
					}
				}
			}));
			fail("save");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
		assertFalse(Context.hasPrivilege(BillingMetadataAccess.MANAGE_CASHIER_METADATA));
	}

	@Test public void privilegeIsRemovedWhenTheLookupThrows() throws Throwable {
		as("Finance", BILLING);
		BillingVisitAccess.open();
		try {
			new BillingVisitAccess().invoke(failing());
			fail("lookup should have thrown");
		}
		catch (RuntimeException e) {
			assertEquals("bill failed", e.getMessage());
		}
		finally {
			BillingVisitAccess.close();
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
		assertFalse(BillingVisitAccess.openNow());
	}

	@Test public void systemsAdministratorAndFacilityInChargeUseTheSameLookup() throws Exception {
		for (String role : new String[] { "Systems Administrator", "Facility in-charge" }) {
			as(role, BILLING);
			BillingVisitAccess.open();
			try {
				assertNotNull(role, Context.getVisitService().getActiveVisitsByPatient(visit.getPatient()));
				assertNotNull(role, Context.getVisitService().getVisit(visit.getVisitId()));
			}
			finally {
				BillingVisitAccess.close();
			}
			assertFalse(role, Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
		}
	}

	@Test public void anExistingGetVisitsPrivilegeIsNotRemoved() throws Exception {
		as("Facility in-charge", concat(BILLING, PrivilegeConstants.GET_VISITS));
		BillingVisitAccess.open();
		try {
			assertNotNull(Context.getVisitService().getVisit(visit.getVisitId()));
		}
		finally {
			BillingVisitAccess.close();
		}
		assertTrue(Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
	}

	@Test public void nurseCannotObtainGetVisitsByPostingABill() throws Exception {
		as("Nurse", "Manage Pharmacy");
		BillingVisitAccess.open();
		try {
			denied("nurse bill post", new Runnable() {
				public void run() { Context.getVisitService().getActiveVisitsByPatient(visit.getPatient()); }
			});
			denied("nurse supplied visit", new Runnable() {
				public void run() { Context.getVisitService().getVisit(visit.getVisitId()); }
			});
		}
		finally {
			BillingVisitAccess.close();
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_VISITS));
	}

	@Test public void onlyABillPostOpensTheLookup() {
		assertTrue(BillingVisitAccess.billSave("POST", "/openmrs/ws/rest/v1/billing/bill"));
		assertTrue(BillingVisitAccess.billSave("post", "/openmrs/ws/rest/v1/billing/bill/8f0a0b0c-1d2e-4f50-9a6b-7c8d9e0f1a2b"));
		assertFalse(BillingVisitAccess.billSave("GET", "/openmrs/ws/rest/v1/billing/bill"));
		assertFalse(BillingVisitAccess.billSave("GET", "/openmrs/ws/rest/v1/visit"));
		assertFalse(BillingVisitAccess.billSave("POST", "/openmrs/ws/rest/v1/visit"));
		assertFalse(BillingVisitAccess.billSave("POST", "/openmrs/ws/rest/v1/billing/billableService"));
		assertFalse(BillingVisitAccess.billSave("POST", "/openmrs/ws/rest/v1/billing/payment"));
	}

	private static String[] concat(String[] first, String extra) {
		String[] all = java.util.Arrays.copyOf(first, first.length + 1);
		all[first.length] = extra;
		return all;
	}

	private static MethodInvocation named(final String name, final Runnable body) throws Exception {
		final Method method = BillingVisitAccessTest.class.getDeclaredMethod(name);
		return new MethodInvocation() {
			public Method getMethod() { return method; }
			public Object[] getArguments() { return new Object[0]; }
			public Object proceed() {
				body.run();
				return Boolean.TRUE;
			}
			public Object getThis() { return null; }
			public AccessibleObject getStaticPart() { return method; }
		};
	}

	public void getCashPointByUuid() { }

	public void saveCashPoint() { }

	private static MethodInvocation failing() {
		return new MethodInvocation() {
			public Method getMethod() {
				try { return Object.class.getMethod("toString"); }
				catch (NoSuchMethodException e) { throw new IllegalStateException(e); }
			}
			public Object[] getArguments() { return new Object[0]; }
			public Object proceed() { throw new RuntimeException("bill failed"); }
			public Object getThis() { return null; }
			public AccessibleObject getStaticPart() { return getMethod(); }
		};
	}

	private static boolean denied(Throwable error) {
		for (; error != null; error = error.getCause()) {
			if (error instanceof ContextAuthenticationException || error instanceof org.openmrs.api.APIAuthenticationException) {
				return true;
			}
		}
		return false;
	}

	private static void denied(String label, Runnable call) {
		try {
			call.run();
			fail(label);
		}
		catch (RuntimeException e) {
			assertTrue(label + " " + e, denied(e));
		}
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
