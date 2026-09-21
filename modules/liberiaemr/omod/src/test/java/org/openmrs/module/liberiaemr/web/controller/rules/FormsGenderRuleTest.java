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

import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.Form;
import org.openmrs.Patient;

public class FormsGenderRuleTest {

    private FormsGenderRule rule;

    @Before
    public void setup() {
        rule = new FormsGenderRule();
    }

    @Test
    public void shouldShowForm_whenPatientIsNull_shouldReturnTrue() {
        Form form = new Form();
        form.setUuid(FormsGenderRule.ANC_INITIAL_VISIT_UUID);
        
        boolean result = rule.shouldShowForm(form, null);
        Assert.assertTrue("Should show form if patient is null", result);
    }
    
    @Test
    public void shouldShowForm_whenFormUuidIsNull_shouldReturnTrue() {
        Patient malePatient = new Patient();
        malePatient.setGender("M");
        
        Form form = new Form();
        form.setUuid(null);
        
        boolean result = rule.shouldShowForm(form, malePatient);
        Assert.assertTrue("Should show form if form UUID is null", result);
    }

    @Test
    public void shouldShowForm_whenPatientIsMaleAndFormIsFemaleOnly_shouldReturnFalse() {
        Patient malePatient = new Patient();
        malePatient.setGender("M");

        Form form = new Form();
        form.setUuid(FormsGenderRule.ANC_INITIAL_VISIT_UUID);

        boolean result = rule.shouldShowForm(form, malePatient);
        Assert.assertFalse("Should hide female-only form for male patient", result);
    }
    
    @Test
    public void shouldShowForm_whenPatientIsMaleAndFormIsNotFemaleOnly_shouldReturnTrue() {
        Patient malePatient = new Patient();
        malePatient.setGender("M");

        Form form = new Form();
        form.setUuid("some-other-uuid");

        boolean result = rule.shouldShowForm(form, malePatient);
        Assert.assertTrue("Should show non-female-only form for male patient", result);
    }

    @Test
    public void shouldShowForm_whenPatientIsFemaleAndFormIsFemaleOnly_shouldReturnTrue() {
        Patient femalePatient = new Patient();
        femalePatient.setGender("F");

        Form form = new Form();
        form.setUuid(FormsGenderRule.ANC_INITIAL_VISIT_UUID);

        boolean result = rule.shouldShowForm(form, femalePatient);
        Assert.assertTrue("Should show female-only form for female patient", result);
    }
    
    @Test
    public void shouldShowForm_whenPatientIsFemaleAndFormIsNotFemaleOnly_shouldReturnTrue() {
        Patient femalePatient = new Patient();
        femalePatient.setGender("F");

        Form form = new Form();
        form.setUuid("some-other-uuid");

        boolean result = rule.shouldShowForm(form, femalePatient);
        Assert.assertTrue("Should show non-female-only form for female patient", result);
    }
}
