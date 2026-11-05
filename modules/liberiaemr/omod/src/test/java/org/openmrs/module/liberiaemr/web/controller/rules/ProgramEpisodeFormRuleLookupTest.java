/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.controller.rules;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.GlobalProperty;
import org.openmrs.Patient;
import org.openmrs.PatientProgram;
import org.openmrs.Person;
import org.openmrs.PersonName;
import org.openmrs.Privilege;
import org.openmrs.Program;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.api.ValidationException;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.web.controller.LiberiaEMRFormsController;
import org.openmrs.test.BaseModuleContextSensitiveTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ContextConfiguration;

/**
 * Real service/DAO lookups against the transactional test database, without overriding rule methods.
 * Tests named currentBehavior document unresolved policy, not approved episode/date semantics.
 */
@ContextConfiguration(locations = "classpath:anc-lookup-test-context.xml")
public class ProgramEpisodeFormRuleLookupTest extends BaseModuleContextSensitiveTest {

    private final ProgramEpisodeFormRule rule = new ProgramEpisodeFormRule();

    private Patient patient;

    private Program program;

    private EncounterType initialType;

    private Form initialForm;

    @Before
    public void metadata() {
        patient = Context.getPatientService().getPatient(2);
        program = new Program();
        program.setName("Episode lookup test programme");
        program.setConcept(Context.getConceptService().getConcept(3));
        program = Context.getProgramWorkflowService().saveProgram(program);
        initialType = new EncounterType();
        initialType.setName("Episode lookup initial");
        initialType.setDescription("Initial encounter type for isolated lookup tests");
        initialType = Context.getEncounterService().saveEncounterType(initialType);
        initialForm = form("2", initialType);
    }

    @Test
    public void noEnrolmentReturnsNull() {
        assertNull(rule.findActiveEnrolment(patient, program.getUuid()));
    }

    @Test
    public void activeEnrolmentIsSelected() {
        PatientProgram active = enrolment("2020-01-01T10:00:00", null);
        assertEquals(active.getUuid(), rule.findActiveEnrolment(patient, program.getUuid()).getUuid());
    }

    @Test
    public void completedAndVoidedEnrolmentsAreExcluded() {
        enrolment("2019-01-01T10:00:00", "2019-02-01T10:00:00");
        PatientProgram voided = enrolment("2020-01-01T10:00:00", null);
        Context.getProgramWorkflowService().voidPatientProgram(voided, "Lookup test");
        assertNull(rule.findActiveEnrolment(patient, program.getUuid()));
    }

    @Test
    public void completedPreviousEpisodeDoesNotReplaceActiveEnrolment() {
        enrolment("2019-01-01T10:00:00", "2019-02-01T10:00:00");
        PatientProgram active = enrolment("2020-01-01T10:00:00", null);
        assertEquals(active.getUuid(), rule.findActiveEnrolment(patient, program.getUuid()).getUuid());
    }

    @Test
    public void currentBehaviorLatestUncompletedEnrolmentWins() {
        enrolment("2019-01-01T10:00:00", null);
        PatientProgram latest = enrolment("2020-01-01T10:00:00", null);
        assertEquals(latest.getUuid(), rule.findActiveEnrolment(patient, program.getUuid()).getUuid());
    }

    @Test
    public void currentBehaviorFutureEnrolmentCanReplaceTodaysEpisode() {
        enrolment("2020-01-01T10:00:00", null);
        PatientProgram future = enrolment("2021-01-01T10:00:00", null);
        // Seed legacy/imported data through Hibernate, bypassing save-service date validation.
        future.setDateEnrolled(date("2099-01-01T10:00:00"));
        Context.flushSession();
        Context.clearSession();
        assertEquals(future.getUuid(), rule.findActiveEnrolment(patient, program.getUuid()).getUuid());
    }

    @Test(expected = ValidationException.class)
    public void saveServiceRejectsNewFutureEnrolment() {
        enrolment("2099-01-01T10:00:00", null);
    }

    @Test
    public void initialEncounterInEpisodeIsFound() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        assertFalse(recorded(active));
        encounter("2020-01-02T10:00:00", initialForm, patient);
        assertTrue(recorded(active));
    }

    @Test
    public void previousEpisodeEncounterDoesNotSatisfyLaterEpisode() {
        enrolment("2019-01-01T00:00:00", "2019-02-01T00:00:00");
        encounter("2019-01-02T10:00:00", initialForm, patient);
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        assertFalse(recorded(active));
    }

    @Test
    public void encounterImmediatelyBeforeEnrolmentDayIsExcludedButMidnightIsIncluded() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        encounter("2019-12-31T23:59:59", initialForm, patient);
        assertFalse(recorded(active));
        encounter("2020-01-01T00:00:00", initialForm, patient);
        assertTrue(recorded(active));
    }

    @Test
    public void voidedInitialEncounterDoesNotCount() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        Encounter initial = encounter("2020-01-02T10:00:00", initialForm, patient);
        assertTrue(recorded(active));
        Context.getEncounterService().voidEncounter(initial, "Lookup test");
        assertFalse(recorded(active));
    }

    @Test
    public void earlierFormVersionWithSameEncounterTypeCounts() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        Form earlier = form("1", initialType);
        encounter("2020-01-02T10:00:00", earlier, patient);
        assertTrue(recorded(active));
    }

    @Test
    public void otherPatientAndOtherEncounterTypeDoNotCount() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        encounter("2020-01-02T10:00:00", initialForm, Context.getPatientService().getPatient(6));
        EncounterType other = new EncounterType();
        other.setName("Episode lookup unrelated");
        other.setDescription("Unrelated encounter type");
        other = Context.getEncounterService().saveEncounterType(other);
        encounter("2020-01-02T10:00:00", form("1", other), patient);
        assertFalse(recorded(active));
    }

    @Test
    public void currentBehaviorEarlierSameDayEncounterCountsAfterReEnrolment() {
        enrolment("2020-01-01T00:00:00", "2020-01-01T09:00:00");
        encounter("2020-01-01T08:00:00", initialForm, patient);
        PatientProgram next = enrolment("2020-01-01T10:00:00", null);
        assertTrue("Known attribution gap: the query starts at midnight, not the new episode", recorded(next));
    }

    @Test
    public void currentBehaviorFutureEncounterCountsWithoutUpperDateBound() {
        PatientProgram active = enrolment("2020-01-01T00:00:00", null);
        Encounter future = encounter("2020-01-02T10:00:00", initialForm, patient);
        // Seed a legacy/imported future date without invoking encounter-save validation.
        future.setEncounterDatetime(date("2099-01-01T10:00:00"));
        Context.flushSession();
        Context.clearSession();
        assertTrue("Future encounter policy awaits clinical/developer clarification", recorded(active));
    }

    @Test(expected = ValidationException.class)
    public void saveServiceRejectsNewFutureEncounter() {
        encounter("2099-01-01T10:00:00", initialForm, patient);
    }

    @Test
    public void activeEnrolmentDoesNotOverrideGenderRestrictionInFormList() {
        configureLauncher();
        enrolment("2020-01-01T00:00:00", null);
        patient.setGender("F");
        assertTrue(listed(initialForm));
        patient.setGender("M");
        assertFalse(listed(initialForm));
    }

    @Test
    public void ancEnrolmentIsNotRequiredToListOpdLabourOrPartographForms() {
        configureLauncher();
        for (String[] identity : new String[][] {
                { "opd-consultation", "consultation" },
                { "first-and-second-stage-of-labor-and-delivery", "labor-delivery" },
                { "partograph", "labor-delivery" } }) {
            String typeUuid = ContentUuids.get("var.encountertype." + identity[1] + ".uuid");
            EncounterType type = Context.getEncounterService().getEncounterTypeByUuid(typeUuid);
            if (type == null) {
                type = new EncounterType(identity[1], "Launcher regression");
                type.setUuid(typeUuid);
                type = Context.getEncounterService().saveEncounterType(type);
            }
            Form other = form("1", type);
            other.setUuid(ContentUuids.get("var.form." + identity[0] + ".uuid"));
            other.setPublished(true);
            Context.getFormService().saveForm(other);
            assertTrue(identity[0] + " must not acquire an ANC enrolment requirement", listed(other));
        }
    }

    @Test
    public void hidingInitialAfterCompletionDoesNotHideOrModifyHistoricalEncounter() {
        configureLauncher();
        PatientProgram episode = enrolment("2020-01-01T00:00:00", null);
        Encounter historical = encounter("2020-01-02T10:00:00", initialForm, patient);
        episode.setDateCompleted(date("2020-02-01T00:00:00"));
        Context.getProgramWorkflowService().savePatientProgram(episode);
        Context.flushSession();
        Context.clearSession();
        assertFalse(listed(initialForm));
        Encounter saved = Context.getEncounterService().getEncounterByUuid(historical.getUuid());
        assertEquals(initialForm.getUuid(), saved.getForm().getUuid());
        assertEquals(date("2020-01-02T10:00:00"), saved.getEncounterDatetime());
        assertFalse(saved.getVoided());
    }

    @Test
    public void activeEnrolmentDoesNotBypassModuleAccessFiltering() throws Exception {
        initialType.setUuid(ContentUuids.get("var.encountertype.anc-initial.uuid"));
        Context.getEncounterService().saveEncounterType(initialType);
        initialForm.setUuid(ContentUuids.get("var.form.anc-initial.uuid"));
        Context.getFormService().saveForm(initialForm);
        configureLauncher();
        patient.setGender("F");
        enrolment("2020-01-01T00:00:00", null);
        Role role = new Role("Registrar");
        role.setDescription("Matrix-role launcher regression");
        for (String name : new String[] { "Get Patients", "Get Forms", "Get Programs",
                "Get Patient Programs", "Get Encounters", "Get Global Properties" }) {
            Privilege privilege = Context.getUserService().getPrivilege(name);
            if (privilege == null) {
                privilege = Context.getUserService().savePrivilege(new Privilege(name, name));
            }
            role.addPrivilege(privilege);
        }
        role = Context.getUserService().saveRole(role);
        Person person = new Person();
        person.addName(new PersonName("Launcher", null, "Regression"));
        person.setGender("F");
        person = Context.getPersonService().savePerson(person);
        User user = new User();
        user.setUsername("anc-launcher-regression");
        user.setPerson(person);
        user.addRole(role);
        String password = java.util.UUID.randomUUID().toString() + "aA1!";
        user = Context.getUserService().createUser(user, password);
        Context.authenticate(user.getUsername(), password);
        assertFalse("An eligible episode cannot grant Manage ANC", listed(initialForm));
        Context.authenticate("admin", "test");
        Privilege manageAnc = Context.getUserService().getPrivilege("Manage ANC");
        if (manageAnc == null) {
            manageAnc = Context.getUserService().savePrivilege(new Privilege("Manage ANC", "Manage ANC"));
        }
        role.addPrivilege(manageAnc);
        Context.getUserService().saveRole(role);
        Context.authenticate(user.getUsername(), password);
        assertTrue("An authorized caller can launch the eligible Initial", listed(initialForm));
    }

    private void configureLauncher() {
        initialForm.setPublished(true);
        Context.getFormService().saveForm(initialForm);
        Context.getAdministrationService().saveGlobalProperty(new GlobalProperty(
                ProgramEpisodeFormRule.GP_PROGRAM_EPISODE_RULES, "[{\"program\":\"" + program.getUuid()
                        + "\",\"initialForms\":[\"" + initialForm.getUuid() + "\"],\"followUpForms\":[]}]"));
        Context.getAdministrationService().saveGlobalProperty(
                new GlobalProperty(FormsGenderRule.GP_FEMALE_ONLY_FORMS_UUIDS, initialForm.getUuid()));
    }

    private boolean listed(Form expected) {
        ResponseEntity<Map<String, Object>> response = new LiberiaEMRFormsController().getForms(patient.getUuid());
        assertEquals(HttpStatus.OK, response.getStatusCode());
        Object results = response.getBody().get("results");
        assertTrue("Form-list results must be an array", results instanceof List);
        for (Object result : (List<?>) results) {
            assertTrue("Each form-list result must be an object", result instanceof Map);
            if (expected.getUuid().equals(((Map<?, ?>) result).get("uuid"))) {
                return true;
            }
        }
        return false;
    }

    private boolean recorded(PatientProgram episode) {
        return rule.isInitialRecorded(patient, episode, Collections.singleton(initialForm.getUuid()));
    }

    private PatientProgram enrolment(String start, String end) {
        PatientProgram enrolment = new PatientProgram();
        enrolment.setPatient(patient);
        enrolment.setProgram(program);
        enrolment.setDateEnrolled(date(start));
        enrolment.setDateCompleted(end == null ? null : date(end));
        return Context.getProgramWorkflowService().savePatientProgram(enrolment);
    }

    private Form form(String version, EncounterType type) {
        Form form = new Form();
        form.setName("Episode lookup " + type.getName());
        form.setVersion(version);
        form.setEncounterType(type);
        return Context.getFormService().saveForm(form);
    }

    private Encounter encounter(String when, Form form, Patient subject) {
        Encounter encounter = new Encounter();
        encounter.setPatient(subject);
        encounter.setEncounterType(form.getEncounterType());
        encounter.setForm(form);
        encounter.setLocation(Context.getLocationService().getLocation(1));
        encounter.setEncounterDatetime(date(when));
        return Context.getEncounterService().saveEncounter(encounter);
    }

    private static Date date(String value) {
        return Date.from(LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant());
    }
}
