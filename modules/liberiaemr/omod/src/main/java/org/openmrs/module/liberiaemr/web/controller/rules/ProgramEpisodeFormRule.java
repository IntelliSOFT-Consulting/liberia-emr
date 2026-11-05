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

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.time.DateUtils;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.Patient;
import org.openmrs.PatientProgram;
import org.openmrs.Program;
import org.openmrs.api.context.Context;
import org.openmrs.parameter.EncounterSearchCriteriaBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Programme-episode form gating (LE-607). For each configured programme, its initial and
 * follow-up forms are offered only to a patient with an active enrolment: the initial form
 * until one is recorded in the episode, the follow-up forms after.
 */
@Component
public class ProgramEpisodeFormRule implements FormVisibilityRule {

    public static final String GP_PROGRAM_EPISODE_RULES = "liberiaemr.forms.programEpisodeRules";

    private static final Logger log = LoggerFactory.getLogger(ProgramEpisodeFormRule.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    @Override
    public boolean shouldShowForm(Form form, Patient patient) {
        if (form == null || form.getUuid() == null || patient == null) {
            return true;
        }
        String formUuid = form.getUuid().toLowerCase(Locale.ROOT);
        for (EpisodeRule rule : getRules()) {
            boolean initial = rule.initialForms.contains(formUuid);
            if (!initial && !rule.followUpForms.contains(formUuid)) {
                continue;
            }
            PatientProgram episode = findActiveEnrolment(patient, rule.programUuid);
            if (episode == null) {
                return false;
            }
            boolean initialRecorded = isInitialRecorded(patient, episode, rule.initialForms);
            return initial != initialRecorded;
        }
        return true;
    }

    protected List<EpisodeRule> getRules() {
        return parseRules(Context.getAdministrationService().getGlobalProperty(GP_PROGRAM_EPISODE_RULES));
    }

    /** The latest non-voided, uncompleted enrolment in the programme, or null. */
    protected PatientProgram findActiveEnrolment(Patient patient, String programUuid) {
        Program program = Context.getProgramWorkflowService().getProgramByUuid(programUuid);
        if (program == null) {
            return null;
        }
        List<PatientProgram> enrolments = Context.getProgramWorkflowService()
                .getPatientPrograms(patient, program, null, null, null, null, false);
        return enrolments.stream()
                .filter(pp -> !pp.getVoided() && pp.getDateCompleted() == null && pp.getDateEnrolled() != null)
                .max(Comparator.comparing(PatientProgram::getDateEnrolled))
                .orElse(null);
    }

    /** True when an encounter of an initial form's type exists from the enrolment day on. */
    protected boolean isInitialRecorded(Patient patient, PatientProgram episode, Set<String> initialFormUuids) {
        List<EncounterType> types = new ArrayList<>();
        for (String uuid : initialFormUuids) {
            Form initialForm = Context.getFormService().getFormByUuid(uuid);
            if (initialForm != null && initialForm.getEncounterType() != null) {
                types.add(initialForm.getEncounterType());
            }
        }
        if (types.isEmpty()) {
            return false;
        }
        Date from = DateUtils.truncate(episode.getDateEnrolled(), Calendar.DATE);
        return !Context.getEncounterService().getEncounters(new EncounterSearchCriteriaBuilder()
                .setPatient(patient)
                .setEncounterTypes(types)
                .setFromDate(from)
                .setIncludeVoided(false)
                .createEncounterSearchCriteria()).isEmpty();
    }

    /** Parses the global property; a missing or malformed value disables the rule. */
    static List<EpisodeRule> parseRules(String json) {
        if (StringUtils.isBlank(json)) {
            return Collections.emptyList();
        }
        try {
            List<EpisodeRule> rules = new ArrayList<>();
            for (JsonNode node : JSON.readTree(json)) {
                String program = node.path("program").asText("");
                Set<String> initial = uuids(node.path("initialForms"));
                if (program.isEmpty() || initial.isEmpty()) {
                    log.warn("{}: skipping a rule with no program or initialForms", GP_PROGRAM_EPISODE_RULES);
                    continue;
                }
                rules.add(new EpisodeRule(program, initial, uuids(node.path("followUpForms"))));
            }
            return rules;
        } catch (Exception e) {
            log.warn("{} is not valid JSON; programme-episode form rules are off", GP_PROGRAM_EPISODE_RULES, e);
            return Collections.emptyList();
        }
    }

    private static Set<String> uuids(JsonNode array) {
        Set<String> result = new HashSet<>();
        for (JsonNode node : array) {
            if (StringUtils.isNotBlank(node.asText())) {
                result.add(node.asText().trim().toLowerCase(Locale.ROOT));
            }
        }
        return result;
    }

    static final class EpisodeRule {

        final String programUuid;

        final Set<String> initialForms;

        final Set<String> followUpForms;

        EpisodeRule(String programUuid, Set<String> initialForms, Set<String> followUpForms) {
            this.programUuid = programUuid;
            this.initialForms = initialForms;
            this.followUpForms = followUpForms;
        }
    }
}
