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

import java.util.Arrays;
import java.util.List;

import org.openmrs.Form;
import org.openmrs.Patient;
import org.openmrs.Visit;
import org.springframework.stereotype.Component;

@Component
public class FormsGenderRule implements FormVisibilityRule {
    
    public static final String FIRST_AND_SECOND_STAGE_OF_LABOR_AND_DELIVERY_UUID = "97880e6c-25e9-30bc-8ab8-bd190e2fc5e4";
    public static final String PARTOGRAPH_UUID = "526d9c5b-70a6-38e8-9048-18c5527369fc";
    public static final String THIRD_STAGE_OF_LABOR_AND_DELIVERY_UUID = "a1f46814-43c4-3690-9b87-ae4644b8b93a";
    public static final String FOURTH_STAGE_MONITORING_FOR_WOMAN_AND_BABY_UUID = "9fc704ef-05d0-3bd1-a29e-a8a345565784";
    public static final String ANC_INITIAL_VISIT_UUID = "55fde540-4334-3896-a51f-63e98bb5317e";
    public static final String ANC_FOLLOWUP_VISIT_UUID = "fbb1a3c2-558f-342c-998c-3ad60337e7fd";
    public static final String MOTHER_PNC_UUID = "7e8cc637-0961-3441-9e51-aef987d0313d";
    public static final String NEWBORN_PNC_UUID = "e318b944-6faa-3828-acd6-6b0c98037070";
    public static final String FAMILY_PLANNING_UUID = "b4f695d8-3926-3d16-bdf3-07a572db534b";

    // Forms that should be hidden for male patients (Female-only forms)
    private static final List<String> FEMALE_ONLY_FORMS_UUIDS = Arrays.asList(
            FIRST_AND_SECOND_STAGE_OF_LABOR_AND_DELIVERY_UUID,
            PARTOGRAPH_UUID,
            THIRD_STAGE_OF_LABOR_AND_DELIVERY_UUID,
            FOURTH_STAGE_MONITORING_FOR_WOMAN_AND_BABY_UUID,
            ANC_INITIAL_VISIT_UUID,
            ANC_FOLLOWUP_VISIT_UUID,
            MOTHER_PNC_UUID,
            NEWBORN_PNC_UUID,
            FAMILY_PLANNING_UUID
    );

    @Override
    public boolean shouldShowForm(Form form, Patient patient, Visit visit) {
        if (patient != null && patient.getGender() != null) {
            String formUuid = form.getUuid();
            if (formUuid != null) {
                // If the patient is male, hide female-only forms
                if ("M".equalsIgnoreCase(patient.getGender())) {
                    for (String femaleFormUuid : FEMALE_ONLY_FORMS_UUIDS) {
                        if (formUuid.equals(femaleFormUuid)) {
                            return false;
                        }
                    }
                }

            }
        }
        return true; // Show all by default
    }
}
