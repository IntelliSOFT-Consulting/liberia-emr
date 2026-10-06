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
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.OrderType;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientIdentifierType;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Role;
import org.openmrs.TestOrder;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessInstaller.FhirWriteAdvice;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.util.PrivilegeConstants;

/**
 * The FHIR write boundary. FHIR2 4.2.0 persists encounter, observation, medication request, and
 * service request through DAO {@code createOrUpdate} and {@code delete}. Observation update is the
 * exception and is asserted through {@code ObsService.saveObs}.
 */
public class FhirWriteGuardTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";
	private final ModuleAccessGuard guard = new ModuleAccessGuard();
	private EncounterType laborType;
	private EncounterType vitalsType;
	private EncounterType triageType;
	private EncounterType labType;
	private Form laborForm;

	@Before public void metadata() {
		ModuleAccessInstaller.install();
		laborType = ensureType("Labor and Delivery", ContentUuids.get("var.encountertype.labor-delivery.uuid"));
		vitalsType = ensureType("Vitals", ContentUuids.get("var.encountertype.vitals.uuid"));
		triageType = ensureType("Triage", ContentUuids.get("var.encountertype.triage.uuid"));
		labType = ensureType("Lab Results", ContentUuids.get("var.encountertypes.lab-results.uuid"));
		laborForm = new Form();
		laborForm.setName("First Stage");
		laborForm.setVersion("1");
		laborForm.setEncounterType(laborType);
		laborForm.setUuid(ContentUuids.get("var.form.first-and-second-stage-of-labor-and-delivery.uuid"));
		laborForm = Context.getFormService().saveForm(laborForm);
	}

	@Test public void fhirEncounterCreateAndUpdateFollowTheMatrix() throws Exception {
		for (String role : new String[] { "Nurse", "Midwife" }) {
			admin();
			as(role, "Write Labor and Delivery");
			allow(labor());
			assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		}
		admin();
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		saved.setEncounterDatetime(new Date());
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS);
		deny(labor());
		deny(saved);
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS);
		deny(labor());
		allow(labEncounter());
		admin();
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.ADD_ENCOUNTERS);
		deny(labEncounter());
	}

	@Test public void fhirEncounterDeleteRequiresWriteOnThePersistedModule() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Nurse", "Write Labor and Delivery");
		List<String> proxied = new ArrayList<>();
		try {
			guard.authorizeFhirDelete(Encounter.class, saved.getUuid(), proxied);
			assertTrue(proxied.contains(PrivilegeConstants.DELETE_ENCOUNTERS));
		}
		finally {
			release(proxied);
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.DELETE_ENCOUNTERS));
		guard.authorizeFhirDelete(Encounter.class, UUID.randomUUID().toString(), new ArrayList<String>());
		admin();
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.DELETE_ENCOUNTERS);
		denyDelete(Encounter.class, saved.getUuid());
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.DELETE_ENCOUNTERS);
		denyDelete(Encounter.class, saved.getUuid());
	}

	@Test public void triageAndVitalsStayWritableAndDoNotAbsorbAnotherModule() throws Exception {
		as("Nurse", "Write Labor and Delivery");
		allow(typed(vitalsType));
		allow(typed(triageType));
		Encounter vitals = typed(vitalsType);
		vitals.addOrder(testOrder(vitals));
		deny(vitals);
		Encounter triage = typed(triageType);
		triage.addOrder(drugOrder(triage));
		deny(triage);
		assertTrue(new ModuleRecordClassifier().appointment().excluded);
	}

	@Test public void fhirObservationWritesFollowEncounterAndOrderProvenance() throws Exception {
		for (String role : new String[] { "Nurse", "Midwife" }) {
			admin();
			as(role, "Write Labor and Delivery");
			allow(observation(labor()));
		}
		admin();
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.ADD_OBS, PrivilegeConstants.EDIT_OBS);
		deny(observation(labor()));
		admin();
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.ADD_OBS);
		deny(observation(labEncounter()));
		admin();
		as("Lab Technician", "Manage Laboratory");
		allow(observation(labEncounter()));
	}

	@Test public void fhirObservationUpdateUsesObsServiceAndCannotRelabel() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		Encounter vitals = Context.getEncounterService().saveEncounter(typed(vitalsType));
		Obs obs = Context.getObsService().saveObs(observation(saved), "created");
		for (String role : new String[] { "Nurse", "Midwife" }) {
			admin();
			as(role, "Write Labor and Delivery", PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_OBS);
			Obs editing = Context.getObsService().getObs(obs.getObsId());
			editing.setValueNumeric(editing.getValueNumeric() + 1);
			assertNotNull(Context.getObsService().saveObs(editing, "updated"));
			assertFalse(Context.hasPrivilege(PrivilegeConstants.EDIT_OBS));
		}
		admin();
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.EDIT_OBS);
		Obs readOnly = Context.getObsService().getObs(obs.getObsId());
		readOnly.setValueNumeric(9.0);
		try {
			Context.getObsService().saveObs(readOnly, "denied");
			fail("read-only Labor and Delivery observation");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
		admin();
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.EDIT_OBS);
		Obs moved = Context.getObsService().getObs(obs.getObsId());
		moved.setEncounter(vitals);
		try {
			Context.getObsService().saveObs(moved, "relabel");
			fail("observation relabel");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	@Test public void laboratoryObservationUpdateFollowsTheMatrix() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labEncounter());
		Obs obs = Context.getObsService().saveObs(observation(saved), "created");
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_OBS);
		Obs editing = Context.getObsService().getObs(obs.getObsId());
		editing.setValueNumeric(2.0);
		assertNotNull(Context.getObsService().saveObs(editing, "updated"));
		admin();
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.EDIT_OBS, PrivilegeConstants.ADD_OBS);
		Obs deniedObs = new Obs();
		deniedObs.setObsId(obs.getObsId());
		deniedObs.setUuid(obs.getUuid());
		deniedObs.setPerson(obs.getPerson());
		deniedObs.setConcept(obs.getConcept());
		deniedObs.setObsDatetime(obs.getObsDatetime());
		deniedObs.setEncounter(saved);
		deniedObs.setValueNumeric(3.0);
		try {
			Context.getObsService().saveObs(deniedObs, "denied");
			fail("nurse laboratory observation");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	@Test public void groupedObservationCyclesStayDenied() throws Exception {
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.ADD_OBS);
		Obs self = new Obs();
		self.setOrder(drugOrder(labor()));
		self.setObsGroup(self);
		deny(self);
		Obs child = new Obs();
		Obs parent = new Obs();
		child.setOrder(drugOrder(labor()));
		parent.setOrder(testOrder(labor()));
		child.setObsGroup(parent);
		parent.setObsGroup(child);
		deny(child);
		Obs conflicting = observation(labEncounter());
		conflicting.setOrder(drugOrder(labEncounter()));
		deny(conflicting);
	}

	@Test public void medicationRequestAndServiceRequestFollowPharmacyAndLaboratory() throws Exception {
		as("Pharmacist", "Manage Pharmacy");
		allow(drugOrder(labor()));
		allow(untypedDrug());
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
		admin();
		as("Nurse", "Manage Pharmacy");
		allow(drugOrder(labor()));
		deny(testOrder(labor()));
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS);
		deny(drugOrder(labor()));
		deny(untypedDrug());
		allow(testOrder(labor()));
		allow(untypedTest());
		admin();
		as("Physician Assistant", "Manage Laboratory");
		allow(testOrder(labor()));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
		admin();
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS);
		deny(testOrder(labor()));
		DrugOrder relabeled = drugOrder(labor());
		relabeled.getOrderType().setUuid(OrderType.TEST_ORDER_TYPE_UUID);
		deny(relabeled);
	}

	@Test public void orderDeleteAndRelabelKeepThePersistedModule() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		DrugOrder drug = (DrugOrder) Context.getOrderService().saveOrder(preparedDrug(saved), null);
		as("Pharmacist", "Manage Pharmacy");
		List<String> proxied = new ArrayList<>();
		try {
			guard.authorizeFhirDelete(DrugOrder.class, drug.getUuid(), proxied);
			assertTrue(proxied.contains(PrivilegeConstants.DELETE_ORDERS));
		}
		finally {
			release(proxied);
		}
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.DELETE_ORDERS);
		denyDelete(DrugOrder.class, drug.getUuid());
		admin();
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.EDIT_ORDERS);
		DrugOrder relabeled = new DrugOrder();
		relabeled.setOrderId(drug.getOrderId());
		relabeled.setUuid(drug.getUuid());
		OrderType testType = new OrderType();
		testType.setUuid(OrderType.TEST_ORDER_TYPE_UUID);
		relabeled.setOrderType(testType);
		deny(relabeled);
		admin();
		TestOrder test = (TestOrder) Context.getOrderService().saveOrder(preparedTest(saved), null);
		as("Nurse", "Manage Pharmacy", PrivilegeConstants.DELETE_ORDERS, PrivilegeConstants.EDIT_ORDERS);
		denyDelete(TestOrder.class, test.getUuid());
		deny(test);
		admin();
		as("Lab Technician", "Manage Laboratory");
		guard.authorizeFhirDelete(TestOrder.class, test.getUuid(), new ArrayList<String>());
	}

	@Test public void persistedEncounterCannotBeRelabeledOutOfItsModule() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		for (EncounterType type : new EncounterType[] { vitalsType, triageType, labType, ensureType("Other", UUID.randomUUID().toString()) }) {
			admin();
			as("Nurse", "Write Labor and Delivery", PrivilegeConstants.EDIT_ENCOUNTERS);
			deny(detached(saved, type));
		}
		admin();
		Encounter laboratory = Context.getEncounterService().saveEncounter(labEncounter());
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.EDIT_ENCOUNTERS);
		deny(detached(laboratory, vitalsType));
	}

	@Test public void proxiedGenericPrivilegeCannotOpenAnotherModule() throws Exception {
		as("Nurse", "Write Labor and Delivery");
		List<String> proxied = new ArrayList<>();
		try {
			guard.authorizeFhir(labor(), proxied);
			assertTrue(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
			deny(labEncounter());
			assertTrue(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		}
		finally {
			release(proxied);
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		admin();
		as("Physician Assistant", "Manage Laboratory");
		proxied = new ArrayList<>();
		try {
			guard.authorizeFhir(testOrder(labor()), proxied);
			assertTrue(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
			deny(drugOrder(labor()));
		}
		finally {
			release(proxied);
		}
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
	}

	@Test public void legacyRoleKeepsFhirBehaviorAndAMatrixRoleDoesNot() throws Throwable {
		legacy("Clinician", PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS, PrivilegeConstants.ADD_OBS,
		    PrivilegeConstants.ADD_ORDERS);
		allow(labor());
		allow(observation(labEncounter()));
		allow(drugOrder(labor()));
		FhirWriteAdvice advice = new FhirWriteAdvice(Encounter.class);
		advice.invoke(invocation(createMethod(), new Object[] { labor() }, new Callable<Object>() {
			public Object call() { return labor(); }
		}));
		admin();
		Role clinician = role("Clinician", PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS,
		    PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS);
		Role lab = role("Lab Technician", "Manage Laboratory");
		User combined = user("clinician-and-lab-" + System.nanoTime(), clinician);
		combined.addRole(lab);
		Context.getUserService().saveUser(combined);
		authenticate(combined);
		deny(labor());
		allow(labEncounter());
		try {
			advice.invoke(invocation(createMethod(), new Object[] { labor() }, new Callable<Object>() {
				public Object call() {
					fail("dual-role create proceeded");
					return null;
				}
			}));
			fail("dual-role FHIR encounter");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	@Test public void inheritingAMatrixRoleCannotBypassFhir() throws Exception {
		Role lab = role("Lab Technician", "Manage Laboratory");
		Role local = new Role("Local Lab FHIR");
		local.setDescription("Local Lab FHIR");
		local.setInheritedRoles(new HashSet<>(Collections.singleton(lab)));
		local.addPrivilege(privilege(PrivilegeConstants.ADD_ENCOUNTERS));
		local.addPrivilege(privilege(PrivilegeConstants.EDIT_ENCOUNTERS));
		local.addPrivilege(privilege(PrivilegeConstants.ADD_ORDERS));
		Context.getUserService().saveRole(local);
		authenticate(user("local-lab-fhir", local));
		deny(labor());
		deny(drugOrder(labor()));
		allow(labEncounter());
	}

	@Test public void adviceDropsTheProxyAndBlocksAProtectedDelete() throws Throwable {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Nurse", "Write Labor and Delivery");
		FhirWriteAdvice advice = new FhirWriteAdvice(Encounter.class);
		advice.invoke(invocation(createMethod(), new Object[] { labor() }, new Callable<Object>() {
			public Object call() {
				assertTrue(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
				return null;
			}
		}));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		admin();
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.DELETE_ENCOUNTERS);
		try {
			advice.invoke(invocation(deleteMethod(), new Object[] { saved.getUuid() }, new Callable<Object>() {
				public Object call() {
					fail("delete proceeded");
					return null;
				}
			}));
			fail("PA FHIR delete");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	public void createOrUpdate(Encounter encounter) { }

	public void delete(String uuid) { }

	private void allow(Object record) {
		List<String> proxied = new ArrayList<>();
		try {
			guard.authorizeFhir(record, proxied);
		}
		finally {
			release(proxied);
		}
	}

	private void deny(Object record) {
		List<String> proxied = new ArrayList<>();
		try {
			guard.authorizeFhir(record, proxied);
			fail("FHIR write should have been denied for " + record.getClass().getSimpleName());
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
		finally {
			release(proxied);
		}
	}

	private void denyDelete(Class<?> type, String uuid) {
		try {
			guard.authorizeFhirDelete(type, uuid, new ArrayList<String>());
			fail("FHIR delete should have been denied");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	private static void release(List<String> proxied) {
		for (int i = proxied.size() - 1; i >= 0; i--) { Context.removeProxyPrivilege(proxied.get(i)); }
	}

	private static MethodInvocation invocation(final Method method, final Object[] arguments, final Callable<Object> body) {
		return new MethodInvocation() {
			public Method getMethod() { return method; }
			public Object[] getArguments() { return arguments; }
			public Object proceed() throws Throwable { return body.call(); }
			public Object getThis() { return null; }
			public AccessibleObject getStaticPart() { return method; }
		};
	}

	private static Method createMethod() throws Exception {
		return FhirWriteGuardTest.class.getDeclaredMethod("createOrUpdate", Encounter.class);
	}

	private static Method deleteMethod() throws Exception {
		return FhirWriteGuardTest.class.getDeclaredMethod("delete", String.class);
	}

	private Encounter detached(Encounter source, EncounterType type) {
		Encounter attack = new Encounter();
		attack.setEncounterId(source.getEncounterId());
		attack.setUuid(source.getUuid());
		attack.setPatient(source.getPatient());
		attack.setEncounterDatetime(source.getEncounterDatetime());
		attack.setLocation(source.getLocation());
		attack.setEncounterType(type);
		return attack;
	}

	private Encounter labor() { return typed(laborType, laborForm); }

	private Encounter labEncounter() { return typed(labType); }

	private Encounter typed(EncounterType type) { return typed(type, null); }

	private Encounter typed(EncounterType type, Form form) {
		boolean patients = Context.hasPrivilege(PrivilegeConstants.GET_PATIENTS);
		boolean locations = Context.hasPrivilege(PrivilegeConstants.GET_LOCATIONS);
		if (!patients) { Context.addProxyPrivilege(PrivilegeConstants.GET_PATIENTS); }
		if (!locations) { Context.addProxyPrivilege(PrivilegeConstants.GET_LOCATIONS); }
		try {
			Encounter encounter = new Encounter();
			encounter.setPatient(Context.getPatientService().getPatient(2));
			encounter.setEncounterType(type);
			encounter.setForm(form);
			encounter.setEncounterDatetime(new Date());
			encounter.setLocation(Context.getLocationService().getLocation(1));
			return encounter;
		}
		finally {
			if (!patients) { Context.removeProxyPrivilege(PrivilegeConstants.GET_PATIENTS); }
			if (!locations) { Context.removeProxyPrivilege(PrivilegeConstants.GET_LOCATIONS); }
		}
	}

	private Obs observation(Encounter encounter) {
		boolean concepts = Context.hasPrivilege(PrivilegeConstants.GET_CONCEPTS);
		if (!concepts) { Context.addProxyPrivilege(PrivilegeConstants.GET_CONCEPTS); }
		try {
			Obs obs = new Obs();
			obs.setPerson(encounter.getPatient());
			obs.setConcept(Context.getConceptService().getConcept(5089));
			obs.setObsDatetime(new Date());
			obs.setEncounter(encounter);
			obs.setValueNumeric(1.0);
			return obs;
		}
		finally {
			if (!concepts) { Context.removeProxyPrivilege(PrivilegeConstants.GET_CONCEPTS); }
		}
	}

	private TestOrder testOrder(Encounter encounter) {
		TestOrder order = new TestOrder();
		OrderType type = new OrderType();
		type.setUuid(OrderType.TEST_ORDER_TYPE_UUID);
		order.setOrderType(type);
		order.setPatient(encounter.getPatient());
		order.setEncounter(encounter);
		return order;
	}

	private DrugOrder drugOrder(Encounter encounter) {
		DrugOrder order = new DrugOrder();
		OrderType type = new OrderType();
		type.setUuid(OrderType.DRUG_ORDER_TYPE_UUID);
		order.setOrderType(type);
		order.setPatient(encounter.getPatient());
		order.setEncounter(encounter);
		return order;
	}

	private DrugOrder untypedDrug() { return new DrugOrder(); }

	private TestOrder untypedTest() { return new TestOrder(); }

	private DrugOrder preparedDrug(Encounter encounter) {
		DrugOrder order = drugOrder(encounter);
		order.setConcept(Context.getConceptService().getConcept(88));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(1));
		order.setUrgency(Order.Urgency.ROUTINE);
		order.setDose(1.0);
		order.setDoseUnits(Context.getConceptService().getConcept(50));
		order.setQuantity(1.0);
		order.setQuantityUnits(Context.getConceptService().getConcept(51));
		order.setNumRefills(0);
		order.setFrequency(Context.getOrderService().getOrderFrequency(1));
		order.setRoute(Context.getConceptService().getConcept(22));
		return order;
	}

	private TestOrder preparedTest(Encounter encounter) {
		TestOrder order = testOrder(encounter);
		order.setConcept(Context.getConceptService().getConcept(5497));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(2));
		order.setUrgency(Order.Urgency.ROUTINE);
		return order;
	}

	private EncounterType ensureType(String name, String uuid) {
		EncounterType type = Context.getEncounterService().getEncounterTypeByUuid(uuid);
		if (type != null) { return type; }
		type = new EncounterType(name, "");
		type.setUuid(uuid);
		return Context.getEncounterService().saveEncounterType(type);
	}

	/** The matrix decision itself, not a missing generic OpenMRS privilege. */
	private static boolean denied(Throwable error) {
		for (; error != null; error = error.getCause()) {
			if (error instanceof ContextAuthenticationException && "Module access denied".equals(error.getMessage())) { return true; }
		}
		return false;
	}

	private void admin() { Context.authenticate("admin", "test"); }

	private void as(String roleName, String... privileges) throws Exception {
		authenticate(user(roleName.toLowerCase().replace(' ', '-') + "-" + System.nanoTime(), role(roleName, privileges)));
	}

	private void legacy(String roleName, String... privileges) throws Exception { as(roleName, privileges); }

	private void authenticate(User user) throws Exception { Context.authenticate(user.getUsername(), PASSWORD); }

	private Role role(String name, String... privilegeNames) {
		Role role = Context.getUserService().getRole(name);
		if (role == null) {
			role = new Role(name);
			role.setDescription(name);
		}
		for (String privilegeName : privilegeNames) { role.addPrivilege(privilege(privilegeName)); }
		return Context.getUserService().saveRole(role);
	}

	private User user(String username, Role role) throws Exception {
		Person person = new Person();
		person.addName(new PersonName(username, null, "User"));
		person.setGender("F");
		person = Context.getPersonService().savePerson(person);
		User user = new User();
		user.setUsername(username);
		user.setPerson(person);
		user.addRole(role);
		return Context.getUserService().createUser(user, PASSWORD);
	}

	private Privilege privilege(String name) {
		Privilege privilege = Context.getUserService().getPrivilege(name);
		if (privilege == null) {
			privilege = new Privilege(name, name);
			privilege = Context.getUserService().savePrivilege(privilege);
		}
		return privilege;
	}
}
