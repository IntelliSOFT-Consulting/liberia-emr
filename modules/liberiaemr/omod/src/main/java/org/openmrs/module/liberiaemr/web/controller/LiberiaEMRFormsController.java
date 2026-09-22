/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openmrs.Form;
import org.openmrs.Patient;
import org.openmrs.Visit;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.web.controller.rules.FormVisibilityRule;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
@RequestMapping("/rest/v1/liberiaemr")
public class LiberiaEMRFormsController {

    @RequestMapping(value = "/forms", method = RequestMethod.GET)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> getForms(
            @RequestParam("patientUuid") String patientUuid) {

        if (StringUtils.isBlank(patientUuid)) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "patientUuid is required");
            return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
        }

        Patient patient = Context.getPatientService().getPatientByUuid(patientUuid);
        if (patient == null) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Patient not found");
            return new ResponseEntity<>(error, HttpStatus.NOT_FOUND);
        }

        List<Form> allForms = Context.getFormService().getAllForms(false);
        List<Map<String, Object>> results = new ArrayList<>();
        
        // Use OpenMRS context to get all registered rules, avoiding Spring context boundary issues
        List<FormVisibilityRule> rules = Context.getRegisteredComponents(FormVisibilityRule.class);

        for (Form form : allForms) {
            // Only include published forms and exclude component forms (standard O3 behavior)
            if (form.getPublished() != null && form.getPublished() && !isComponentForm(form)) {
                
                // Evaluate all rules
                boolean shouldShow = true;
                if (rules != null) {
                    for (FormVisibilityRule rule : rules) {
                        if (!rule.shouldShowForm(form, patient)) {
                            shouldShow = false;
                            break;
                        }
                    }
                }

                if (shouldShow) {
                    results.add(mapFormToJson(form));
                }
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("results", results);
        
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
    
    private boolean isComponentForm(Form form) {
        if (form.getName() == null) {
            return false;
        }
        return form.getName().toLowerCase().contains("component");
    }

    private Map<String, Object> mapFormToJson(Form form) {
        Map<String, Object> map = new HashMap<>();
        map.put("uuid", form.getUuid());
        map.put("name", form.getName());
        map.put("display", form.getName());
        map.put("version", form.getVersion());
        map.put("published", form.getPublished());
        map.put("retired", form.getRetired());
        
        if (form.getEncounterType() != null) {
            Map<String, Object> encTypeMap = new HashMap<>();
            encTypeMap.put("uuid", form.getEncounterType().getUuid());
            encTypeMap.put("display", form.getEncounterType().getName());
            if (form.getEncounterType().getEditPrivilege() != null) {
                Map<String, Object> privMap = new HashMap<>();
                privMap.put("display", form.getEncounterType().getEditPrivilege().getPrivilege());
                encTypeMap.put("editPrivilege", privMap);
            }
            map.put("encounterType", encTypeMap);
        }
        
        return map;
    }
}
