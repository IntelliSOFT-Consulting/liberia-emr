/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.programs;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.time.DateUtils;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.PatientProgram;
import org.openmrs.Program;
import org.openmrs.api.context.Context;
import org.openmrs.parameter.EncounterSearchCriteriaBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Completes programme enrolments once a closing encounter is recorded in them (LE-608). Each
 * rule names a programme and the encounter types and forms that end it; the earliest such
 * encounter on or after the enrolment day becomes the completion date.
 */
public class ProgramAutoClose {

	public static final String GP_AUTO_CLOSE_RULES = "liberiaemr.programs.autoCloseRules";

	private static final Logger log = LoggerFactory.getLogger(ProgramAutoClose.class);

	private static final ObjectMapper JSON = new ObjectMapper();

	/** @return how many enrolments were completed */
	public int run() {
		int closed = 0;
		for (Rule rule : parseRules(Context.getAdministrationService().getGlobalProperty(GP_AUTO_CLOSE_RULES))) {
			Program program = Context.getProgramWorkflowService().getProgramByUuid(rule.programUuid);
			if (program == null) {
				log.warn("{}: no programme {}", GP_AUTO_CLOSE_RULES, rule.programUuid);
				continue;
			}
			List<EncounterType> types = encounterTypes(rule.encounterTypeUuids);
			List<Form> forms = allVersions(rule.formUuids);
			for (PatientProgram enrolment : Context.getProgramWorkflowService().getPatientPrograms(null, program, null,
			    null, null, null, false)) {
				if (enrolment.getDateCompleted() != null || enrolment.getDateEnrolled() == null) {
					continue;
				}
				try {
					Date completed = closingDate(enrolment.getDateEnrolled(), closingEncounters(enrolment, types, forms));
					if (completed != null) {
						enrolment.setDateCompleted(completed);
						Context.getProgramWorkflowService().savePatientProgram(enrolment);
						closed++;
					}
				}
				catch (Exception e) {
					log.error("Failed to auto-close enrolment {}", enrolment.getUuid(), e);
				}
			}
		}
		return closed;
	}

	/**
	 * @return the earliest closing encounter's date, not before the enrolment date, or null when
	 *         none is on or after the enrolment day
	 */
	static Date closingDate(Date dateEnrolled, Collection<Encounter> encounters) {
		Date from = startOfDay(dateEnrolled);
		Date earliest = null;
		for (Encounter encounter : encounters) {
			Date at = encounter.getEncounterDatetime();
			if (at != null && !at.before(from) && (earliest == null || at.before(earliest))) {
				earliest = at;
			}
		}
		if (earliest == null) {
			return null;
		}
		return earliest.before(dateEnrolled) ? dateEnrolled : earliest;
	}

	private static List<Encounter> closingEncounters(PatientProgram enrolment, List<EncounterType> types,
	        List<Form> forms) {
		List<Encounter> result = new ArrayList<>();
		Date from = startOfDay(enrolment.getDateEnrolled());
		if (!types.isEmpty()) {
			result.addAll(Context.getEncounterService().getEncounters(new EncounterSearchCriteriaBuilder()
			        .setPatient(enrolment.getPatient()).setFromDate(from).setEncounterTypes(types).setIncludeVoided(false)
			        .createEncounterSearchCriteria()));
		}
		if (!forms.isEmpty()) {
			result.addAll(Context.getEncounterService().getEncounters(new EncounterSearchCriteriaBuilder()
			        .setPatient(enrolment.getPatient()).setFromDate(from).setEnteredViaForms(forms).setIncludeVoided(false)
			        .createEncounterSearchCriteria()));
		}
		return result;
	}

	private static List<EncounterType> encounterTypes(Set<String> uuids) {
		List<EncounterType> types = new ArrayList<>();
		for (String uuid : uuids) {
			EncounterType type = Context.getEncounterService().getEncounterTypeByUuid(uuid);
			if (type != null) {
				types.add(type);
			}
		}
		return types;
	}

	/** Every version of each named form: a new form version has a new UUID. */
	private static List<Form> allVersions(Set<String> uuids) {
		Set<String> names = new HashSet<>();
		for (String uuid : uuids) {
			Form form = Context.getFormService().getFormByUuid(uuid);
			if (form != null && form.getName() != null) {
				names.add(form.getName());
			}
		}
		List<Form> forms = new ArrayList<>();
		if (!names.isEmpty()) {
			for (Form form : Context.getFormService().getAllForms(true)) {
				if (names.contains(form.getName())) {
					forms.add(form);
				}
			}
		}
		return forms;
	}

	private static Date startOfDay(Date date) {
		return DateUtils.truncate(date, Calendar.DATE);
	}

	/** Parses the global property; a missing or malformed value turns auto-close off. */
	static List<Rule> parseRules(String json) {
		if (StringUtils.isBlank(json)) {
			return Collections.emptyList();
		}
		try {
			List<Rule> rules = new ArrayList<>();
			for (JsonNode node : JSON.readTree(json)) {
				String program = node.path("program").asText("");
				Set<String> types = uuids(node.path("closeOnEncounterTypes"));
				Set<String> forms = uuids(node.path("closeOnForms"));
				if (program.isEmpty() || (types.isEmpty() && forms.isEmpty())) {
					log.warn("{}: skipping a rule with no program or closing encounter", GP_AUTO_CLOSE_RULES);
					continue;
				}
				rules.add(new Rule(program, types, forms));
			}
			return rules;
		}
		catch (Exception e) {
			log.warn("{} is not valid JSON; programme auto-close is off", GP_AUTO_CLOSE_RULES, e);
			return Collections.emptyList();
		}
	}

	private static Set<String> uuids(JsonNode array) {
		Set<String> result = new HashSet<>();
		for (JsonNode node : array) {
			if (StringUtils.isNotBlank(node.asText())) {
				result.add(node.asText().trim());
			}
		}
		return result;
	}

	static final class Rule {

		final String programUuid;

		final Set<String> encounterTypeUuids;

		final Set<String> formUuids;

		Rule(String programUuid, Set<String> encounterTypeUuids, Set<String> formUuids) {
			this.programUuid = programUuid;
			this.encounterTypeUuids = encounterTypeUuids;
			this.formUuids = formUuids;
		}
	}
}
