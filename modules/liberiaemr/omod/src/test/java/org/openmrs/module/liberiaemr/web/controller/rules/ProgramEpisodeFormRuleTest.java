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
import static org.junit.Assert.assertTrue;

import java.util.Date;
import java.util.List;
import java.util.Set;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Form;
import org.openmrs.Patient;
import org.openmrs.PatientProgram;

public class ProgramEpisodeFormRuleTest {

    private static final String ANC_PROGRAM = "38c602a1-e487-46ab-a231-e2a09ef61c29";

    private static final String ANC_INITIAL = "30259289-f0ea-3604-b57d-91bfe4e68d5d";

    private static final String ANC_FOLLOWUP = "2818c1e9-9e97-3829-8065-1ae43b590736";

    private static final String RULES = "[{\"program\":\"" + ANC_PROGRAM + "\",\"initialForms\":[\"" + ANC_INITIAL
            + "\"],\"followUpForms\":[\"" + ANC_FOLLOWUP + "\"]}]";

    private PatientProgram enrolment;

    private boolean initialRecorded;

    private ProgramEpisodeFormRule rule;

    private final Patient patient = new Patient();

    @Before
    public void setup() {
        enrolment = null;
        initialRecorded = false;
        rule = new ProgramEpisodeFormRule() {

            @Override
            protected List<EpisodeRule> getRules() {
                return parseRules(RULES);
            }

            @Override
            protected PatientProgram findActiveEnrolment(Patient p, String programUuid) {
                return ANC_PROGRAM.equals(programUuid) ? enrolment : null;
            }

            @Override
            protected boolean isInitialRecorded(Patient p, PatientProgram episode, Set<String> initialForms) {
                return initialRecorded;
            }
        };
    }

    private static Form form(String uuid) {
        Form form = new Form();
        form.setUuid(uuid);
        return form;
    }

    private void enrol() {
        enrolment = new PatientProgram();
        enrolment.setDateEnrolled(new Date());
    }

    @Test
    public void notEnrolled_hidesInitialAndFollowUp() {
        assertFalse(rule.shouldShowForm(form(ANC_INITIAL), patient));
        assertFalse(rule.shouldShowForm(form(ANC_FOLLOWUP), patient));
    }

    @Test
    public void enrolledWithoutInitial_showsInitialOnly() {
        enrol();
        assertTrue(rule.shouldShowForm(form(ANC_INITIAL), patient));
        assertFalse(rule.shouldShowForm(form(ANC_FOLLOWUP), patient));
    }

    @Test
    public void enrolledWithInitial_showsFollowUpOnly() {
        enrol();
        initialRecorded = true;
        assertFalse(rule.shouldShowForm(form(ANC_INITIAL), patient));
        assertTrue(rule.shouldShowForm(form(ANC_FOLLOWUP), patient));
    }

    @Test
    public void unconfiguredForm_isAlwaysShown() {
        assertTrue(rule.shouldShowForm(form("6b1e0f2a-0000-4000-8000-000000000001"), patient));
    }

    @Test
    public void formUuidMatch_ignoresCase() {
        enrol();
        assertTrue(rule.shouldShowForm(form(ANC_INITIAL.toUpperCase()), patient));
    }

    @Test
    public void nullPatientOrForm_isShown() {
        assertTrue(rule.shouldShowForm(form(ANC_INITIAL), null));
        assertTrue(rule.shouldShowForm(null, patient));
        assertTrue(rule.shouldShowForm(form(null), patient));
    }

    @Test
    public void parseRules_blankOrMalformed_disablesRule() {
        assertTrue(ProgramEpisodeFormRule.parseRules(null).isEmpty());
        assertTrue(ProgramEpisodeFormRule.parseRules("  ").isEmpty());
        assertTrue(ProgramEpisodeFormRule.parseRules("{not json").isEmpty());
    }

    @Test
    public void parseRules_skipsRuleWithoutProgramOrInitialForms() {
        assertEquals(0, ProgramEpisodeFormRule.parseRules("[{\"initialForms\":[\"a\"]},{\"program\":\"p\"}]").size());
        assertEquals(1, ProgramEpisodeFormRule.parseRules(RULES).size());
    }
}
