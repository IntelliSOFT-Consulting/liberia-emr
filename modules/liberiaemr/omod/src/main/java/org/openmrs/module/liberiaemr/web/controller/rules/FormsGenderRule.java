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
    public static final String GP_FEMALE_ONLY_FORMS_UUIDS = "liberiaemr.forms.femaleOnlyUuids";

    protected List<String> getFemaleOnlyFormsUuids() {
        String uuidsString = org.openmrs.api.context.Context.getAdministrationService().getGlobalProperty(GP_FEMALE_ONLY_FORMS_UUIDS);
        if (uuidsString != null && !uuidsString.trim().isEmpty()) {
            return Arrays.asList(uuidsString.split("\\s*,\\s*"));
        }
        return java.util.Collections.emptyList();
    }

    @Override
    public boolean shouldShowForm(Form form, Patient patient) {
        if (patient != null && patient.getGender() != null) {
            String formUuid = form.getUuid();
            if (formUuid != null) {
                // If the patient is male, hide female-only forms
                if ("M".equalsIgnoreCase(patient.getGender())) {
                    List<String> femaleOnlyFormsUuids = getFemaleOnlyFormsUuids();
                    for (String femaleFormUuid : femaleOnlyFormsUuids) {
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
