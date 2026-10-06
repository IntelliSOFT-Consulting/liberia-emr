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
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.Concept;
import org.openmrs.ConceptName;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.Location;
import org.openmrs.Patient;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.Visit;
import org.openmrs.VisitType;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.openmrs.util.PrivilegeConstants;

/**
 * Physician Assistant, Systems Administrator and Facility in-charge can open a visit and launch a
 * form. The eventual encounter is still decided by the module matrix.
 */
public class FormWorkflowSupportTest extends BaseModuleContextSensitiveTest {
	private static final String PASSWORD = "Module-access-password1";
	private static final String[] GENERIC = { PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.ADD_ENCOUNTERS,
	        PrivilegeConstants.EDIT_ENCOUNTERS, PrivilegeConstants.GET_OBS, PrivilegeConstants.ADD_OBS,
	        PrivilegeConstants.EDIT_OBS, PrivilegeConstants.GET_ORDERS, PrivilegeConstants.ADD_ORDERS,
	        PrivilegeConstants.EDIT_ORDERS };
	private EncounterType consultation;
	private EncounterType anc;
	private EncounterType labor;
	private EncounterType tb;
	private EncounterType immunizations;
	private Form general;
	private Form ancForm;
	private Form pnc;
	private Form family;
	private Form immunization;
	private Form laborForm;
	private Form tbForm;
	private Concept concept;
	private Patient patient;
	private Location location;
	private VisitType visitType;

	@Before public void metadata() {
		ModuleAccessInstaller.install();
		Role authenticated = Context.getUserService().getRole("Authenticated");
		Privilege locations = Context.getUserService().getPrivilege(PrivilegeConstants.GET_LOCATIONS);
		if (locations == null) {
			locations = Context.getUserService().savePrivilege(new Privilege(PrivilegeConstants.GET_LOCATIONS, "locations"));
		}
		authenticated.addPrivilege(locations);
		Context.getUserService().saveRole(authenticated);
		consultation = type("Consultation", ContentUuids.get("var.encountertype.consultation.uuid"));
		anc = type("ANC initial", ContentUuids.get("var.encountertype.anc-initial.uuid"));
		labor = type("Labor", ContentUuids.get("var.encountertype.labor-delivery.uuid"));
		tb = type("TB", ContentUuids.get("var.encountertype.tb-screening.uuid"));
		immunizations = type("Immunizations", ContentUuids.get("var.encountertypes.immunizations.uuid"));
		general = form("OPD consultation", ContentUuids.get("var.form.opd-consultation.uuid"), consultation);
		ancForm = form("ANC initial", ContentUuids.get("var.form.anc-initial.uuid"), anc);
		pnc = form("PNC", ContentUuids.get("var.form.pnc-national.uuid"), consultation);
		family = form("Family planning", ContentUuids.get("var.form.family-planning-national.uuid"), consultation);
		immunization = form("Immunization", ContentUuids.get("var.form.immunization.uuid"), consultation);
		laborForm = form("Labor", ContentUuids.get("var.form.first-and-second-stage-of-labor-and-delivery.uuid"), labor);
		tbForm = form("TB screening", ContentUuids.get("var.form.tb-screening.uuid"), tb);
		concept = new Concept();
		concept.setDatatype(Context.getConceptService().getConceptDatatypeByName("N/A"));
		concept.setConceptClass(Context.getConceptService().getConceptClassByName("Misc"));
		ConceptName name = new ConceptName("LE39 workflow " + System.nanoTime(), Locale.ENGLISH);
		name.setLocalePreferred(true);
		concept.addName(name);
		concept = Context.getConceptService().saveConcept(concept);
		patient = Context.getPatientService().getPatient(2);
		location = Context.getLocationService().getLocation(1);
		visitType = Context.getVisitService().getVisitType(1);
		for (Visit existing : Context.getVisitService().getActiveVisitsByPatient(patient)) {
			Date stop = new Date();
			if (existing.getStartDatetime() != null && !existing.getStartDatetime().before(stop)) {
				stop = new Date(existing.getStartDatetime().getTime() + 1000L);
			}
			existing.setStopDatetime(stop);
			Context.getVisitService().saveVisit(existing);
		}
	}

	@Test public void physicianAssistantCompletesAuthorizedFormsAndIsRefusedTheOthers() throws Exception {
		as("Physician Assistant");
		Visit visit = new Visit();
		visit.setPatient(patient);
		visit.setVisitType(visitType);
		visit.setStartDatetime(new Date());
		visit.setLocation(location);
		visit = Context.getVisitService().saveVisit(visit);
		assertNotNull(Context.getVisitService().getActiveVisitsByPatient(patient));
		assertEquals(visit.getVisitId(), Context.getVisitService().getVisit(visit.getVisitId()).getVisitId());
		assertEquals(general.getUuid(), Context.getFormService().getFormByUuid(general.getUuid()).getUuid());
		assertEquals(ancForm.getUuid(), Context.getFormService().getFormByUuid(ancForm.getUuid()).getUuid());
		assertNotNull("Get Forms loads a form the matrix forbids writing", Context.getFormService().getFormByUuid(pnc.getUuid()));
		assertEquals(concept.getConceptId(), Context.getConceptService().getConcept(concept.getConceptId()).getConceptId());
		assertNotNull(save(general, consultation));
		assertNotNull(save(ancForm, anc));
		denied(new Runnable() { public void run() { save(pnc, consultation); } });
		denied(new Runnable() { public void run() { save(family, consultation); } });
		denied(new Runnable() { public void run() { save(laborForm, labor); } });
		denied(new Runnable() { public void run() { save(immunization, consultation); } });
		denied(new Runnable() { public void run() { save(null, immunizations); } });
		Encounter laborRecord = savedAsAdmin(laborForm, labor);
		Encounter immunizationRecord = savedAsAdmin(immunization, consultation);
		Encounter dedicated = savedAsAdmin(null, immunizations);
		Encounter pncRecord = savedAsAdmin(pnc, consultation);
		as("Physician Assistant");
		assertEquals(laborRecord.getUuid(), Context.getEncounterService().getEncounterByUuid(laborRecord.getUuid()).getUuid());
		assertEquals(immunizationRecord.getUuid(),
		    Context.getEncounterService().getEncounterByUuid(immunizationRecord.getUuid()).getUuid());
		assertEquals(dedicated.getUuid(), Context.getEncounterService().getEncounterByUuid(dedicated.getUuid()).getUuid());
		final Encounter hidden = pncRecord;
		denied(new Runnable() {
			public void run() { Context.getEncounterService().getEncounterByUuid(hidden.getUuid()); }
		});
		for (String privilege : GENERIC) { assertFalse(privilege, Context.hasPrivilege(privilege)); }
	}

	@Test public void systemsAdministratorAndFacilityInChargeSaveEveryWritableForm() throws Exception {
		for (String role : new String[] { "Systems Administrator", "Facility in-charge" }) {
			as(role);
			assertNotNull(role, Context.getFormService().getFormByUuid(general.getUuid()));
			assertNotNull(role, save(tbForm, tb));
			assertNotNull(role, save(general, consultation));
			assertNotNull(role, save(ancForm, anc));
			assertNotNull(role, save(pnc, consultation));
			assertNotNull(role, save(laborForm, labor));
			assertNotNull(role, save(immunization, consultation));
			assertNotNull(role, save(family, consultation));
			denied(new Runnable() {
				public void run() { save(pnc, labor); }
			});
			for (String privilege : GENERIC) { assertFalse(role + " " + privilege, Context.hasPrivilege(privilege)); }
		}
	}

	private Encounter save(Form form, EncounterType type) {
		Encounter encounter = new Encounter();
		encounter.setPatient(patient);
		if (form != null) { encounter.setForm(form); }
		encounter.setEncounterType(type);
		encounter.setEncounterDatetime(new Date());
		encounter.setLocation(location);
		return Context.getEncounterService().saveEncounter(encounter);
	}

	private Encounter savedAsAdmin(Form form, EncounterType type) throws Exception {
		Context.authenticate("admin", "test");
		return save(form, type);
	}

	private void as(String roleName) throws Exception {
		Context.authenticate("admin", "test");
		Map<String, String[]> rows = ModuleEntitlementsTest.roles();
		Set<String> privileges = ModuleEntitlementsTest.grants(roleName, rows, new HashSet<String>());
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

	private EncounterType type(String name, String uuid) {
		EncounterType existing = Context.getEncounterService().getEncounterTypeByUuid(uuid);
		if (existing != null) { return existing; }
		EncounterType created = new EncounterType(name, "");
		created.setUuid(uuid);
		return Context.getEncounterService().saveEncounterType(created);
	}

	private Form form(String name, String uuid, EncounterType type) {
		Form existing = Context.getFormService().getFormByUuid(uuid);
		if (existing != null) { return existing; }
		Form created = new Form();
		created.setName(name);
		created.setVersion("1");
		created.setUuid(uuid);
		created.setEncounterType(type);
		created.setPublished(true);
		return Context.getFormService().saveForm(created);
	}

	private static void denied(Runnable call) {
		try {
			call.run();
			fail("expected denial");
		}
		catch (RuntimeException e) {
			for (Throwable error = e; error != null; error = error.getCause()) {
				if (error instanceof ContextAuthenticationException && "Module access denied".equals(error.getMessage())) {
					return;
				}
			}
			throw e;
		}
	}
}
