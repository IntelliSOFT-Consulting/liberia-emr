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
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.MedicationDispense;
import org.openmrs.OrderGroup;
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
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.util.PrivilegeConstants;

/**
 * Service enforcement for matrix roles, and the absence of that enforcement for everyone else.
 */
public class ModuleAccessGuardTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";
	private EncounterType laborType;
	private Form laborForm;
	private EncounterType vitalsType;

	@Before public void metadata() {
		ModuleAccessInstaller.install();
		// OpenMRS core seeds Authenticated with Get Locations (liquibase-core-data); the test dataset does not.
		// EncounterService.saveEncounter reloads a saved encounter's location through LocationService.
		Role authenticated = Context.getUserService().getRole("Authenticated");
		authenticated.addPrivilege(privilege(PrivilegeConstants.GET_LOCATIONS));
		Context.getUserService().saveRole(authenticated);
		laborType = ensureType("Labor and Delivery", ContentUuids.get("var.encountertype.labor-delivery.uuid"));
		vitalsType = ensureType("Vitals", ContentUuids.get("var.encountertype.vitals.uuid"));
		laborForm = new Form();
		laborForm.setName("First Stage");
		laborForm.setVersion("1");
		laborForm.setEncounterType(laborType);
		laborForm.setUuid(ContentUuids.get("var.form.first-and-second-stage-of-labor-and-delivery.uuid"));
		laborForm = Context.getFormService().saveForm(laborForm);
	}

	@Test public void nurseAndMidwifeCanWriteLaborAndDelivery() throws Exception {
		as("Nurse", "Write Labor and Delivery");
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		assertNotNull(saved.getEncounterId());
		saved.setEncounterDatetime(new Date());
		assertNotNull(Context.getEncounterService().saveEncounter(saved).getEncounterId());
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS));
		admin();
		as("Midwife", "Write Labor and Delivery");
		Encounter midwife = Context.getEncounterService().saveEncounter(labor());
		midwife.setEncounterDatetime(new Date());
		assertNotNull(Context.getEncounterService().saveEncounter(midwife).getEncounterId());
	}

	@Test public void physicianAssistantCanReadLaborAndDeliveryButNotChangeIt() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Physician Assistant", "Read Labor and Delivery");
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ENCOUNTERS));
		assertNotNull(Context.getEncounterService().getEncounter(saved.getEncounterId()));
		assertFalse("Get Encounters proxy must not outlive the call", Context.hasPrivilege(PrivilegeConstants.GET_ENCOUNTERS));
		assertDeniedSave(saved);
		assertDeniedVoid(saved);
	}

	@Test public void physicianAssistantProxyDoesNotRevealVitalsOrLaboratory() throws Exception {
		Encounter labor = Context.getEncounterService().saveEncounter(labor());
		Encounter vitals = labor();
		vitals.setEncounterType(vitalsType);
		vitals.setForm(null);
		vitals = Context.getEncounterService().saveEncounter(vitals);
		EncounterType labType = ensureType("Lab Results", ContentUuids.get("var.encountertypes.lab-results.uuid"));
		Encounter lab = labor();
		lab.setEncounterType(labType);
		lab.setForm(null);
		lab = Context.getEncounterService().saveEncounter(lab);
		as("Physician Assistant", "Read Labor and Delivery");
		assertNotNull(Context.getEncounterService().getEncounter(labor.getEncounterId()));
		assertDeniedGet(vitals.getEncounterId());
		assertDeniedGet(lab.getEncounterId());
		List<Encounter> visible = Context.getEncounterService().getEncountersByPatient(labor.getPatient());
		for (Encounter found : visible) {
			if (found.getEncounterId().equals(vitals.getEncounterId()) || found.getEncounterId().equals(lab.getEncounterId())) {
				fail("proxied Get Encounters returned " + found.getEncounterType());
			}
		}
	}

	@Test public void labTechnicianCannotReadOrWriteLaborAndDeliveryDespiteGenericPrivileges() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Lab Technician", PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS,
		        "Manage Laboratory");
		assertDeniedGet(saved.getEncounterId());
		assertDeniedSave(labor());
		saved.setEncounterType(vitalsType);
		saved.setForm(null);
		assertDeniedSave(saved);
	}

	@Test public void clinicianWithoutAMatrixRoleKeepsGenericClinicalAccess() throws Exception {
		legacy("Clinician", PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS,
		        PrivilegeConstants.GET_OBS, PrivilegeConstants.ADD_OBS);
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		assertNotNull(Context.getEncounterService().getEncounter(saved.getEncounterId()));
		saved.setEncounterDatetime(new Date());
		assertNotNull(Context.getEncounterService().saveEncounter(saved).getEncounterId());
	}

	@Test public void clinicianAndAMatrixRoleCannotBypassTheMatrix() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		Role clinician = role("Clinician", PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS,
		        PrivilegeConstants.EDIT_ENCOUNTERS);
		Role lab = role("Lab Technician", "Manage Laboratory");
		User combined = user("clinician-and-lab-" + System.nanoTime(), clinician);
		combined.addRole(lab);
		Context.getUserService().saveUser(combined);
		authenticate(combined);
		assertDeniedGet(saved.getEncounterId());
		assertDeniedSave(labor());
	}

	@Test public void inheritingAMatrixRoleCannotBeBypassedByGenericPrivileges() throws Exception {
		Role lab = role("Lab Technician");
		Role local = new Role("Local Lab");
		local.setDescription("Local Lab");
		local.setInheritedRoles(new HashSet<>(Collections.singleton(lab)));
		local.addPrivilege(privilege(PrivilegeConstants.ADD_ENCOUNTERS));
		local.addPrivilege(privilege(PrivilegeConstants.GET_ENCOUNTERS));
		local.addPrivilege(privilege(PrivilegeConstants.EDIT_ENCOUNTERS));
		Context.getUserService().saveRole(local);
		authenticate(user("local-lab", local));
		assertDeniedSave(labor());
	}

	@Test public void physicianAssistantCannotAddAnObservationToLaborAndDelivery() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Physician Assistant", "Read Labor and Delivery", PrivilegeConstants.ADD_OBS);
		try {
			Context.getObsService().saveObs(observation(saved), "denied");
			fail("read-only Labor and Delivery");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	@Test public void nurseCannotRelabelLaborAndDeliveryAsVitals() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		// Sign in first: creating the user flushes the session, which would persist the relabel before the save.
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.EDIT_ENCOUNTERS);
		saved.setForm(null);
		saved.setEncounterType(vitalsType);
		assertDeniedSave(saved);
	}

	@Test public void immunizationReadDoesNotAllowWrite() throws Exception {
		EncounterType immunization = ensureType("Immunizations", ContentUuids.get("var.encountertypes.immunizations.uuid"));
		Encounter encounter = labor();
		encounter.setForm(null);
		encounter.setEncounterType(immunization);
		Encounter saved = Context.getEncounterService().saveEncounter(encounter);
		as("Physician Assistant", "Read Immunization");
		assertNotNull(Context.getEncounterService().getEncounter(saved.getEncounterId()));
		assertDeniedSave(saved);
	}

	@Test public void nurseCanWriteTbScreeningAndMidwifeCannot() throws Exception {
		EncounterType screening = ensureType("TB Screening", ContentUuids.get("var.encountertype.tb-screening.uuid"));
		Encounter encounter = labor();
		encounter.setForm(null);
		encounter.setEncounterType(screening);
		as("Nurse", "Write TB Screening");
		Encounter saved = Context.getEncounterService().saveEncounter(encounter);
		assertNotNull(saved.getEncounterId());
		admin();
		as("Midwife", "Read TB Screening", PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS);
		assertNotNull(Context.getEncounterService().getEncounter(saved.getEncounterId()));
		assertDeniedSave(saved);
	}

	@Test public void nurseCannotCreateALaboratoryOrderAndLabTechnicianCan() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.ADD_ORDERS);
		try {
			Context.getOrderService().saveOrder(testOrder(saved), null);
			fail("Nurse has no Laboratory grant");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
		admin();
		TestOrder order = testOrder(saved);
		order.setConcept(Context.getConceptService().getConcept(5497));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(2));
		order.setUrgency(org.openmrs.Order.Urgency.ROUTINE);
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_ORDERS);
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ORDER_TYPES));
		assertNotNull(Context.getOrderService().saveOrder(order, null).getOrderId());
		assertFalse(Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_ORDER_TYPES));
	}

	@Test public void pharmacistCanCreateADrugOrderAndLabTechnicianCannot() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		DrugOrder order = preparedDrug(saved);
		DrugOrder pharmacy = preparedDrug(saved);
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_ORDERS);
		assertNotNull(Context.getOrderService().saveOrder(order, null).getOrderId());
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.GET_ORDERS);
		try {
			Context.getOrderService().saveOrder(pharmacy, null);
			fail("Lab Technician has no Pharmacy grant");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	@Test public void activeOrderSearchDoesNotLeakPharmacyToTheLabTechnician() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		org.openmrs.Order savedOrder = Context.getOrderService().saveOrder(preparedDrug(saved), null);
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.GET_ORDERS, PrivilegeConstants.GET_CONCEPTS);
		for (org.openmrs.Order found : Context.getOrderService().getActiveOrders(saved.getPatient(), null, null, null)) {
			if (found.getOrderId().equals(savedOrder.getOrderId())) { fail("Laboratory read returned a Pharmacy order"); }
		}
		try {
			Context.getOrderService().getOrder(savedOrder.getOrderId());
			fail("direct pharmacy order read");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	@Test public void pharmacistCannotReadALaboratoryOrder() throws Exception {
		Encounter saved = Context.getEncounterService().saveEncounter(labor());
		TestOrder order = testOrder(saved);
		order.setConcept(Context.getConceptService().getConcept(5497));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(2));
		order.setUrgency(org.openmrs.Order.Urgency.ROUTINE);
		org.openmrs.Order savedOrder = Context.getOrderService().saveOrder(order, null);
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.GET_ORDERS);
		try {
			Context.getOrderService().getOrder(savedOrder.getOrderId());
			fail("Pharmacy read returned a Laboratory order");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	@Test public void vitalsAndTriageStayAvailableAndDoNotAbsorbOrders() throws Exception {
		EncounterType triage = ensureType("Triage", ContentUuids.get("var.encountertype.triage.uuid"));
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.GET_ENCOUNTERS);
		Encounter vitals = labor();
		vitals.setEncounterType(vitalsType);
		vitals.setForm(null);
		assertNotNull(Context.getEncounterService().saveEncounter(vitals).getEncounterId());
		Encounter triageEncounter = labor();
		triageEncounter.setEncounterType(triage);
		triageEncounter.setForm(null);
		assertNotNull(Context.getEncounterService().saveEncounter(triageEncounter).getEncounterId());
		Encounter withTest = labor();
		withTest.setEncounterType(vitalsType);
		withTest.setForm(null);
		withTest.addOrder(testOrder(withTest));
		assertDeniedSave(withTest);
		Encounter withDrug = labor();
		withDrug.setEncounterType(vitalsType);
		withDrug.setForm(null);
		withDrug.addOrder(drugOrder(withDrug));
		assertDeniedSave(withDrug);
	}

	@Test public void registrarCanRegisterAndNurseCannot() throws Exception {
		Patient registered = patient("Reg", "Istrar");
		Patient rejected = patient("No", "Write");
		as("Registrar", PrivilegeConstants.ADD_PATIENTS, PrivilegeConstants.GET_PATIENTS, PrivilegeConstants.EDIT_PATIENTS);
		assertNotNull(Context.getPatientService().savePatient(registered).getPatientId());
		admin();
		as("Nurse", PrivilegeConstants.GET_PATIENTS);
		assertNotNull(Context.getPatientService().getPatient(2));
		try {
			Context.getPatientService().savePatient(rejected);
			fail("Nurse registration is read-only");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), denied(e));
		}
	}

	@Test public void recordsOfficerRegistrationIsNotIntercepted() throws Exception {
		Patient registered = patient("Record", "Officer");
		legacy("Records Officer", PrivilegeConstants.ADD_PATIENTS, PrivilegeConstants.EDIT_PATIENTS, PrivilegeConstants.GET_PATIENTS);
		assertNotNull(Context.getPatientService().savePatient(registered).getPatientId());
	}

	@Test public void pharmacyWriteRolesCanDispenseAndOthersCannot() throws Exception {
		for (String role : new String[] { "Pharmacist", "Nurse", "Midwife", "Physician Assistant", "Systems Administrator",
		        "Facility in-charge" }) {
			admin();
			as(role, "Manage Pharmacy");
			List<String> proxied = new ArrayList<>();
			try {
				ModuleAccessGuard.authorizeDispense(linkedDispense(), false, proxied);
				assertTrue(role + " proxy", proxied.contains(PrivilegeConstants.EDIT_MEDICATION_DISPENSE));
			}
			finally {
				for (String privilege : proxied) { Context.removeProxyPrivilege(privilege); }
			}
			assertFalse(Context.hasPrivilege(PrivilegeConstants.EDIT_MEDICATION_DISPENSE));
		}
		for (String role : new String[] { "Lab Technician", "Registrar", "Finance" }) {
			admin();
			as(role, PrivilegeConstants.GET_PATIENTS);
			try {
				ModuleAccessGuard.authorizeDispense(linkedDispense(), false, new ArrayList<String>());
				fail(role + " must not dispense");
			}
			catch (RuntimeException e) {
				assertTrue(role, denied(e));
			}
		}
	}

	@Test public void anUnlinkedDispenseIsDenied() throws Exception {
		as("Nurse", "Manage Pharmacy");
		MedicationDispense dispense = new MedicationDispense();
		try {
			ModuleAccessGuard.authorizeDispense(dispense, false, new ArrayList<String>());
			fail("missing drug order");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	@Test public void transferRequiresWriteOnTheTransferredModule() throws Exception {
		Patient target = Context.getPatientService().getPatient(7);
		EncounterType labType = ensureType("Lab Results", ContentUuids.get("var.encountertypes.lab-results.uuid"));
		String[] generic = { PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS };
		Encounter nurseLabor = savedLabor();
		Encounter nurseLab = savedOfType(labType);
		as("Nurse", concat(generic, "Write Labor and Delivery"));
		assertNotNull(Context.getEncounterService().transferEncounter(nurseLabor, target).getEncounterId());
		assertDeniedTransfer(nurseLab, target);
		admin();
		Encounter midwifeLabor = savedLabor();
		as("Midwife", concat(generic, "Write Labor and Delivery"));
		assertNotNull(Context.getEncounterService().transferEncounter(midwifeLabor, target).getEncounterId());
		admin();
		Encounter assistantLabor = savedLabor();
		as("Physician Assistant", concat(generic, "Read Labor and Delivery"));
		assertDeniedTransfer(assistantLabor, target);
		admin();
		Encounter technicianLabor = savedLabor();
		as("Lab Technician", concat(generic, "Manage Laboratory"));
		assertDeniedTransfer(technicianLabor, target);
		admin();
		Encounter labWithDrug = labor();
		labWithDrug.setEncounterType(labType);
		labWithDrug.setForm(null);
		labWithDrug.addOrder(preparedDrug(labWithDrug));
		Encounter savedLabWithDrug = Context.getEncounterService().saveEncounter(labWithDrug);
		as("Lab Technician", concat(generic, "Manage Laboratory"));
		assertDeniedTransfer(savedLabWithDrug, target);
	}

	@Test public void transferStaysOpenToClinicianAndClosedToClinicianWithAMatrixRole() throws Exception {
		Patient target = Context.getPatientService().getPatient(7);
		Encounter first = savedLabor();
		Encounter second = savedLabor();
		Role clinician = role("Clinician", PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS,
		        PrivilegeConstants.EDIT_ENCOUNTERS);
		authenticate(user("clinician-transfer-" + System.nanoTime(), clinician));
		assertNotNull(Context.getEncounterService().transferEncounter(first, target).getEncounterId());
		admin();
		User combined = user("clinician-and-lab-transfer-" + System.nanoTime(), clinician);
		combined.addRole(role("Lab Technician", "Manage Laboratory"));
		Context.getUserService().saveUser(combined);
		authenticate(combined);
		assertDeniedTransfer(second, target);
	}

	@Test public void retrospectiveOrdersFollowTheLaboratoryAndPharmacyCells() throws Exception {
		Encounter saved = savedEarlyLabor();
		String[] generic = { PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_ORDERS, PrivilegeConstants.ADD_ORDERS,
		        PrivilegeConstants.EDIT_ORDERS };
		// Role, its configured Laboratory/Pharmacy grants, then the approved Laboratory and Pharmacy cells.
		Object[][] cells = { { "Lab Technician", new String[] { "Manage Laboratory" }, true, false },
		        { "Pharmacist", new String[] { "Manage Pharmacy" }, false, true },
		        { "Nurse", new String[] { "Manage Pharmacy" }, false, true },
		        { "Physician Assistant", new String[] { "Manage Laboratory", "Manage Pharmacy" }, true, true } };
		for (Object[] cell : cells) {
			admin();
			TestOrder test = retrospective(preparedTest(saved));
			DrugOrder drug = retrospective(preparedDrug(saved));
			as((String) cell[0], concat(generic, (String[]) cell[1]));
			org.openmrs.Order savedTest = assertRetrospective(cell[0] + " Laboratory", test, (Boolean) cell[2]);
			org.openmrs.Order savedDrug = assertRetrospective(cell[0] + " Pharmacy", drug, (Boolean) cell[3]);
			admin();
			for (org.openmrs.Order created : new org.openmrs.Order[] { savedTest, savedDrug }) {
				if (created != null) { Context.getOrderService().voidOrder(created, "next role"); }
			}
		}
		TestOrder ambiguous = retrospective(preparedTest(saved));
		ambiguous.setOrderType(Context.getOrderService().getOrderType(1));
		// The role still holds Manage Laboratory and Manage Pharmacy from the loop above.
		as("Physician Assistant", generic);
		assertRetrospective("Test order carrying the drug order type", ambiguous, false);
	}

	@Test public void retrospectiveOrdersStayOpenToClinicianAndClosedToClinicianWithAMatrixRole() throws Exception {
		Encounter saved = savedEarlyLabor();
		TestOrder first = retrospective(preparedTest(saved));
		TestOrder second = retrospective(preparedTest(saved));
		Role clinician = role("Clinician", PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_ORDERS,
		        PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS, PrivilegeConstants.GET_ORDER_TYPES);
		authenticate(user("clinician-retro-" + System.nanoTime(), clinician));
		assertRetrospective("Clinician", first, true);
		admin();
		User combined = user("clinician-and-pharmacist-retro-" + System.nanoTime(), clinician);
		combined.addRole(role("Pharmacist", "Manage Pharmacy"));
		Context.getUserService().saveUser(combined);
		authenticate(combined);
		assertRetrospective("Clinician and Pharmacist", second, false);
	}

	@Test public void complexAndRevisionObservationsAreModuleReads() throws Exception {
		EncounterType labType = ensureType("Lab Results", ContentUuids.get("var.encountertypes.lab-results.uuid"));
		org.openmrs.Obs lab = Context.getObsService().saveObs(observation(savedOfType(labType)), null);
		org.openmrs.Obs laborObs = Context.getObsService().saveObs(observation(savedLabor()), null);
		lab.setValueNumeric(2.0);
		org.openmrs.Obs labRevision = Context.getObsService().saveObs(lab, "revised");
		org.openmrs.Obs original = Context.getObsService().getObs(lab.getObsId());
		as("Nurse", "Write Labor and Delivery", PrivilegeConstants.GET_OBS);
		assertDenied("getComplexObs", () -> Context.getObsService().getComplexObs(lab.getObsId(), null));
		assertDenied("getRevisionObs", () -> Context.getObsService().getRevisionObs(original));
		assertNotNull(Context.getObsService().getComplexObs(laborObs.getObsId(), null));
		admin();
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.GET_OBS);
		assertNotNull(Context.getObsService().getComplexObs(lab.getObsId(), null));
		org.openmrs.Obs revision = Context.getObsService().getRevisionObs(original);
		assertTrue(revision != null && revision.getObsId().equals(labRevision.getObsId()));
		admin();
		as("Physician Assistant", "Read Labor and Delivery");
		assertNotNull(Context.getObsService().getComplexObs(laborObs.getObsId(), null));
		assertFalse(Context.hasPrivilege(PrivilegeConstants.GET_OBS));
		admin();
		legacy("Clinician", PrivilegeConstants.GET_OBS);
		assertNotNull(Context.getObsService().getComplexObs(lab.getObsId(), null));
		assertNotNull(Context.getObsService().getRevisionObs(original));
	}

	@Test public void discontinuationAndRevisionOrdersAreModuleReads() throws Exception {
		Encounter saved = savedEarlyLabor();
		org.openmrs.Order discontinued = Context.getOrderService().saveOrder(earlier(preparedDrug(saved)), null);
		org.openmrs.Order stop = Context.getOrderService().discontinueOrder(discontinued, "stop", null,
		    Context.getProviderService().getProvider(1), saved);
		// The replacement starts after the stop. Backdating it before dateStopped makes OpenMRS
		// treat the schedules as overlapping once that instant falls on the previous calendar day.
		DrugOrder replacement = preparedDrug(saved);
		replacement.setDateActivated(new Date(discontinued.getDateStopped().getTime() + 1000L));
		org.openmrs.Order revised = Context.getOrderService().saveOrder(replacement, null);
		DrugOrder revision = (DrugOrder) revised.cloneForRevision();
		revision.setDateActivated(new Date());
		revision.setOrderer(Context.getProviderService().getProvider(1));
		revision.setEncounter(saved);
		revision.setDose(2.0);
		org.openmrs.Order savedRevision = Context.getOrderService().saveOrder(revision, null);
		as("Lab Technician", "Manage Laboratory", PrivilegeConstants.GET_ORDERS);
		assertDenied("getDiscontinuationOrder", () -> Context.getOrderService().getDiscontinuationOrder(discontinued));
		assertDenied("getRevisionOrder", () -> Context.getOrderService().getRevisionOrder(revised));
		admin();
		as("Pharmacist", "Manage Pharmacy", PrivilegeConstants.GET_ORDERS);
		assertTrue(stop.getOrderId().equals(Context.getOrderService().getDiscontinuationOrder(discontinued).getOrderId()));
		assertTrue(savedRevision.getOrderId().equals(Context.getOrderService().getRevisionOrder(revised).getOrderId()));
		admin();
		legacy("Clinician", PrivilegeConstants.GET_ORDERS);
		assertNotNull(Context.getOrderService().getDiscontinuationOrder(discontinued));
		assertNotNull(Context.getOrderService().getRevisionOrder(revised));
	}

	@Test public void orderGroupsDecideEveryOrderBeforeAnythingIsSaved() throws Exception {
		Encounter saved = savedEarlyLabor();
		String[] generic = { PrivilegeConstants.GET_ORDERS, PrivilegeConstants.EDIT_ORDERS, PrivilegeConstants.GET_CONCEPTS };
		DrugOrder direct = earlier(preparedDrug(saved));
		OrderGroup drugGroup = group(saved, earlier(preparedDrug(saved)));
		TestOrder allowedTest = earlier(preparedTest(saved));
		DrugOrder deniedDrug = earlier(preparedDrug(saved));
		OrderGroup mixed = group(saved, allowedTest, deniedDrug);
		OrderGroup testGroup = group(saved, earlier(preparedTest(saved)));
		as("Lab Technician", concat(generic, "Manage Laboratory"));
		assertDenied("direct Pharmacy order", () -> Context.getOrderService().saveOrder(direct, null));
		assertGroupDenied("Pharmacy group", drugGroup);
		assertGroupDenied("mixed group", mixed);
		assertTrue("allowed child of a denied group was not saved", allowedTest.getOrderId() == null);
		assertGroupSaved("Laboratory group", testGroup);
		assertFalse("Add Orders proxy must not outlive the call", Context.hasPrivilege(PrivilegeConstants.ADD_ORDERS));
		admin();
		voidAll(testGroup);
		OrderGroup pharmacy = group(saved, earlier(preparedDrug(saved)));
		OrderGroup laboratory = group(saved, earlier(preparedTest(saved)));
		as("Pharmacist", concat(generic, "Manage Pharmacy"));
		assertGroupSaved("Pharmacy group", pharmacy);
		assertGroupDenied("Laboratory group", laboratory);
		admin();
		TestOrder ambiguousOrder = earlier(preparedTest(saved));
		ambiguousOrder.setOrderType(Context.getOrderService().getOrderType(1));
		OrderGroup ambiguous = group(saved, ambiguousOrder);
		as("Physician Assistant", concat(generic, "Manage Laboratory", "Manage Pharmacy"));
		assertGroupDenied("Test order carrying the drug order type", ambiguous);
	}

	@Test public void orderGroupsStayOpenToClinicianAndClosedToClinicianWithAMatrixRole() throws Exception {
		Encounter saved = savedEarlyLabor();
		OrderGroup legacy = group(saved, earlier(preparedDrug(saved)));
		OrderGroup withLab = group(saved, earlier(preparedDrug(saved)));
		OrderGroup withPharmacy = group(saved, earlier(preparedTest(saved)));
		Role clinician = role("Clinician", PrivilegeConstants.GET_ORDERS, PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS,
		        PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_ORDER_TYPES);
		authenticate(user("clinician-group-" + System.nanoTime(), clinician));
		assertGroupSaved("Clinician", legacy);
		admin();
		voidAll(legacy);
		User clinicianAndLab = user("clinician-lab-group-" + System.nanoTime(), clinician);
		clinicianAndLab.addRole(role("Lab Technician", "Manage Laboratory"));
		Context.getUserService().saveUser(clinicianAndLab);
		authenticate(clinicianAndLab);
		assertGroupDenied("Clinician and Lab Technician, Pharmacy group", withLab);
		admin();
		User clinicianAndPharmacist = user("clinician-pharmacist-group-" + System.nanoTime(), clinician);
		clinicianAndPharmacist.addRole(role("Pharmacist", "Manage Pharmacy"));
		Context.getUserService().saveUser(clinicianAndPharmacist);
		authenticate(clinicianAndPharmacist);
		assertGroupDenied("Clinician and Pharmacist, Laboratory group", withPharmacy);
	}

	@Test public void anOrderGroupIsReadableOnlyWhenEveryOrderInItIs() throws Exception {
		Encounter saved = savedEarlyLabor();
		TestOrder test = earlier(preparedTest(saved));
		OrderGroup laboratory = Context.getOrderService().saveOrderGroup(group(saved, test));
		OrderGroup pharmacy = Context.getOrderService().saveOrderGroup(group(saved, earlier(preparedDrug(saved))));
		TestOrder mixedTest = earlier(preparedTest(saved));
		mixedTest.setConcept(Context.getConceptService().getConcept(5089));
		DrugOrder mixedDrug = earlier(preparedDrug(saved));
		mixedDrug.setConcept(Context.getConceptService().getConcept(3));
		OrderGroup mixed = Context.getOrderService().saveOrderGroup(group(saved, mixedTest, mixedDrug));
		org.openmrs.Patient patient = saved.getPatient();
		// Role, then whether its Laboratory and Pharmacy cells can read.
		Object[][] cells = { { "Pharmacist", new String[] { "Manage Pharmacy", PrivilegeConstants.GET_ORDERS }, false, true },
		        { "Lab Technician", new String[] { "Manage Laboratory", PrivilegeConstants.GET_ORDERS }, true, false },
		        { "Nurse", new String[] { "Manage Pharmacy" }, false, true },
		        { "Midwife", new String[] { "Manage Laboratory", "Manage Pharmacy" }, true, true },
		        { "Physician Assistant", new String[] { "Manage Laboratory", "Manage Pharmacy" }, true, true },
		        { "Systems Administrator", new String[] { "Manage Laboratory", "Manage Pharmacy" }, true, true },
		        { "Facility in-charge", new String[] { "Manage Laboratory", "Manage Pharmacy" }, true, true } };
		for (Object[] cell : cells) {
			admin();
			String label = (String) cell[0];
			boolean lab = (Boolean) cell[2];
			boolean drug = (Boolean) cell[3];
			as(label, (String[]) cell[1]);
			if (!lab) { assertDenied(label + " direct test order", () -> Context.getOrderService().getOrderByUuid(test.getUuid())); }
			assertGroupRead(label + " Laboratory", laboratory, patient, saved, lab);
			assertGroupRead(label + " Pharmacy", pharmacy, patient, saved, drug);
			assertGroupRead(label + " mixed", mixed, patient, saved, lab && drug);
			assertFalse(label + " Get Orders proxy", !Context.getUserService().getRole(label).hasPrivilege(PrivilegeConstants.GET_ORDERS)
			        && Context.hasPrivilege(PrivilegeConstants.GET_ORDERS));
		}
		admin();
		Role clinician = role("Clinician", PrivilegeConstants.GET_ORDERS);
		authenticate(user("clinician-group-read-" + System.nanoTime(), clinician));
		assertGroupRead("Clinician", mixed, patient, saved, true);
		admin();
		User combined = user("clinician-pharmacist-read-" + System.nanoTime(), clinician);
		combined.addRole(role("Pharmacist"));
		Context.getUserService().saveUser(combined);
		authenticate(combined);
		assertGroupRead("Clinician and Pharmacist Laboratory", laboratory, patient, saved, false);
		assertGroupRead("Clinician and Pharmacist Pharmacy", pharmacy, patient, saved, true);
	}

	private OrderGroup group(Encounter encounter, org.openmrs.Order... orders) {
		OrderGroup group = new OrderGroup();
		group.setEncounter(encounter);
		for (org.openmrs.Order order : orders) { group.addOrder(order); }
		return group;
	}

	private void assertGroupSaved(String label, OrderGroup group) {
		Context.getOrderService().saveOrderGroup(group);
		assertNotNull(label, group.getOrderGroupId());
		for (org.openmrs.Order order : group.getOrders()) { assertNotNull(label, order.getOrderId()); }
	}

	/** Denied before the group row or any order in it is written. */
	private void assertGroupDenied(String label, OrderGroup group) throws Exception {
		assertDenied(label, () -> Context.getOrderService().saveOrderGroup(group));
		assertTrue(label + " group was written", group.getOrderGroupId() == null);
		for (org.openmrs.Order order : group.getOrders()) { assertTrue(label + " order was written", order.getOrderId() == null); }
	}

	private void voidAll(OrderGroup group) {
		for (org.openmrs.Order order : group.getOrders()) { Context.getOrderService().voidOrder(order, "next case"); }
	}

	private void assertGroupRead(String label, OrderGroup group, org.openmrs.Patient patient, Encounter encounter, boolean allowed)
	        throws Exception {
		if (allowed) {
			assertNotNull(label, Context.getOrderService().getOrderGroupByUuid(group.getUuid()));
			assertNotNull(label, Context.getOrderService().getOrderGroup(group.getOrderGroupId()));
		}
		else {
			assertDenied(label + " by uuid", () -> Context.getOrderService().getOrderGroupByUuid(group.getUuid()));
			assertDenied(label + " by id", () -> Context.getOrderService().getOrderGroup(group.getOrderGroupId()));
		}
		assertEquals(label + " by patient", allowed, containsGroup(Context.getOrderService().getOrderGroupsByPatient(patient), group));
		assertEquals(label + " by encounter", allowed,
		    containsGroup(Context.getOrderService().getOrderGroupsByEncounter(encounter), group));
	}

	private static boolean containsGroup(List<OrderGroup> groups, OrderGroup wanted) {
		for (OrderGroup found : groups) {
			if (found.getOrderGroupId().equals(wanted.getOrderGroupId())) { return true; }
		}
		return false;
	}

	private interface Call { Object run() throws Exception; }

	private static void assertDenied(String label, Call call) throws Exception {
		try {
			call.run();
			fail(label + " should have been denied");
		}
		catch (RuntimeException e) {
			assertTrue(label + ": " + e, moduleDenied(e));
		}
	}

	private void assertDeniedTransfer(Encounter encounter, Patient target) throws Exception {
		assertDenied("transfer", () -> Context.getEncounterService().transferEncounter(encounter, target));
	}

	private org.openmrs.Order assertRetrospective(String label, org.openmrs.Order order, boolean allowed) throws Exception {
		if (!allowed) {
			assertDenied(label, () -> Context.getOrderService().saveRetrospectiveOrder(order, null));
			return null;
		}
		org.openmrs.Order saved = Context.getOrderService().saveRetrospectiveOrder(order, null);
		assertNotNull(label, saved.getOrderId());
		return saved;
	}

	private static <T extends org.openmrs.Order> T retrospective(T order) {
		order.setDateActivated(new Date(System.currentTimeMillis() - 2L * 24 * 60 * 60 * 1000));
		return order;
	}

	private static <T extends org.openmrs.Order> T earlier(T order) {
		order.setDateActivated(new Date(System.currentTimeMillis() - 60L * 60 * 1000));
		return order;
	}

	private static String[] concat(String[] generic, String... modules) {
		String[] all = java.util.Arrays.copyOf(generic, generic.length + modules.length);
		System.arraycopy(modules, 0, all, generic.length, modules.length);
		return all;
	}

	private Encounter savedLabor() {
		return Context.getEncounterService().saveEncounter(labor());
	}

	/** Orders cannot be activated before their encounter. */
	private Encounter savedEarlyLabor() {
		Encounter encounter = labor();
		encounter.setEncounterDatetime(new Date(System.currentTimeMillis() - 3L * 24 * 60 * 60 * 1000));
		return Context.getEncounterService().saveEncounter(encounter);
	}

	private Encounter savedOfType(EncounterType type) {
		Encounter encounter = labor();
		encounter.setEncounterType(type);
		encounter.setForm(null);
		return Context.getEncounterService().saveEncounter(encounter);
	}

	private TestOrder preparedTest(Encounter encounter) {
		TestOrder order = testOrder(encounter);
		order.setConcept(Context.getConceptService().getConcept(5497));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(2));
		order.setUrgency(org.openmrs.Order.Urgency.ROUTINE);
		return order;
	}

	private MedicationDispense linkedDispense() {
		MedicationDispense dispense = new MedicationDispense();
		dispense.setDrugOrder(drugOrder(labor()));
		return dispense;
	}

	private DrugOrder preparedDrug(Encounter encounter) {
		DrugOrder order = drugOrder(encounter);
		order.setConcept(Context.getConceptService().getConcept(88));
		order.setOrderer(Context.getProviderService().getProvider(1));
		order.setCareSetting(Context.getOrderService().getCareSetting(1));
		order.setDateActivated(new Date());
		order.setOrderType(Context.getOrderService().getOrderType(1));
		order.setUrgency(org.openmrs.Order.Urgency.ROUTINE);
		order.setDose(1.0);
		order.setDoseUnits(Context.getConceptService().getConcept(50));
		order.setQuantity(1.0);
		order.setQuantityUnits(Context.getConceptService().getConcept(51));
		order.setNumRefills(0);
		order.setFrequency(Context.getOrderService().getOrderFrequency(1));
		order.setRoute(Context.getConceptService().getConcept(22));
		return order;
	}

	private org.openmrs.Obs observation(Encounter encounter) {
		boolean concepts = Context.hasPrivilege(PrivilegeConstants.GET_CONCEPTS);
		if (!concepts) { Context.addProxyPrivilege(PrivilegeConstants.GET_CONCEPTS); }
		try {
			org.openmrs.Obs obs = new org.openmrs.Obs();
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

	private Patient patient(String given, String family) {
		Patient patient = new Patient();
		patient.addName(new PersonName(given, null, family));
		patient.setGender("F");
		patient.setBirthdate(new Date());
		PatientIdentifierType type = Context.getPatientService().getPatientIdentifierType(2);
		PatientIdentifier identifier = new PatientIdentifier(given + "-" + family, type, Context.getLocationService().getLocation(1));
		identifier.setPreferred(true);
		patient.addIdentifier(identifier);
		return patient;
	}

	private void assertDeniedSave(Encounter encounter) {
		try {
			Context.getEncounterService().saveEncounter(encounter);
			fail("save should have been denied");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	private void assertDeniedVoid(Encounter encounter) {
		try {
			Context.getEncounterService().voidEncounter(encounter, "denied");
			fail("void should have been denied");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	private void assertDeniedGet(Integer id) {
		try {
			Context.getEncounterService().getEncounter(id);
			fail("read should have been denied");
		}
		catch (RuntimeException e) {
			assertTrue(e.toString(), moduleDenied(e));
		}
	}

	/** The matrix decision itself, not a missing generic OpenMRS privilege. */
	private static boolean moduleDenied(Throwable error) {
		for (; error != null; error = error.getCause()) {
			if (error instanceof ContextAuthenticationException && "Module access denied".equals(error.getMessage())) { return true; }
		}
		return false;
	}

	@Test public void appointmentReadCannotSaveRecurringAppointments() throws Exception {
		as("Registrar", "View Appointments", "View Appointment Services");
		try {
			ModuleAccessInstaller.requireAppointmentWrite();
			fail("Registrar is appointments read only");
		}
		catch (ContextAuthenticationException expected) { }
		admin();
		as("Facility in-charge", "View Appointments", "View Appointment Services");
		try {
			ModuleAccessInstaller.requireAppointmentWrite();
			fail("Facility in-charge is appointments read only");
		}
		catch (ContextAuthenticationException expected) { }
		admin();
		as("Nurse", "View Appointments", "View Appointment Services", "Manage Appointments");
		ModuleAccessInstaller.requireAppointmentWrite();
		admin();
		as("Physician Assistant", "View Appointments", "View Appointment Services", "Manage Appointments");
		ModuleAccessInstaller.requireAppointmentWrite();
		admin();
		as("Systems Administrator", "View Appointments", "View Appointment Services", "Manage Appointments");
		ModuleAccessInstaller.requireAppointmentWrite();
		admin();
		as("Clinician", PrivilegeConstants.GET_PATIENTS);
		ModuleAccessInstaller.requireAppointmentWrite();
	}

	private static boolean denied(Throwable error) {
		while (error != null) {
			if (error instanceof ContextAuthenticationException || error instanceof org.openmrs.api.APIAuthenticationException) {
				return true;
			}
			if (error.getMessage() != null && (error.getMessage().contains("Module access denied")
			        || error.getMessage().contains("privilegesRequired"))) {
				return true;
			}
			error = error.getCause();
		}
		return false;
	}

	private Encounter labor() {
		boolean patients = Context.hasPrivilege(PrivilegeConstants.GET_PATIENTS);
		boolean locations = Context.hasPrivilege(PrivilegeConstants.GET_LOCATIONS);
		if (!patients) { Context.addProxyPrivilege(PrivilegeConstants.GET_PATIENTS); }
		if (!locations) { Context.addProxyPrivilege(PrivilegeConstants.GET_LOCATIONS); }
		try {
			Encounter encounter = new Encounter();
			encounter.setPatient(Context.getPatientService().getPatient(2));
			encounter.setEncounterType(laborType);
			encounter.setForm(laborForm);
			encounter.setEncounterDatetime(new Date());
			encounter.setLocation(Context.getLocationService().getLocation(1));
			return encounter;
		}
		finally {
			if (!patients) { Context.removeProxyPrivilege(PrivilegeConstants.GET_PATIENTS); }
			if (!locations) { Context.removeProxyPrivilege(PrivilegeConstants.GET_LOCATIONS); }
		}
	}

	private EncounterType ensureType(String name, String uuid) {
		EncounterType type = Context.getEncounterService().getEncounterTypeByUuid(uuid);
		if (type != null) { return type; }
		type = new EncounterType(name, "");
		type.setUuid(uuid);
		return Context.getEncounterService().saveEncounterType(type);
	}

	private void admin() { Context.authenticate("admin", "test"); }

	private void as(String roleName, String... privileges) throws Exception {
		authenticate(user(roleName.toLowerCase().replace(' ', '-') + "-" + System.nanoTime(), role(roleName, privileges)));
	}

	private void legacy(String roleName, String... privileges) throws Exception {
		as(roleName, privileges);
	}

	private void authenticate(User user) throws Exception {
		Context.authenticate(user.getUsername(), PASSWORD);
	}

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
