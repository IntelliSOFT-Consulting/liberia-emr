/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotehistory;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

import org.openmrs.Allergy;
import org.openmrs.AllergyReaction;
import org.openmrs.Concept;
import org.openmrs.ConceptName;
import org.openmrs.Condition;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.Location;
import org.openmrs.Obs;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientProgram;
import org.openmrs.PatientState;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Builds central's remote history response (LE-382; ADR 0013 §4) from records already loaded:
 * one FHIR R4 collection {@code Bundle} per source facility, holding only the ADR-scoped resource
 * types listed in {@link #RESOURCE_TYPES}. It reads, never writes, and needs no OpenMRS context, so
 * every rule here is unit-tested on plain objects.
 * <p>
 * Every resource is attributed to the facility its record was made at: the facility (nearest
 * Health Facility ancestor) of the record's own location, or of its encounter's, or else of the
 * patient record's location (its preferred identifier's), the rule the identity service uses for a
 * record's facility of origin. Records at the requesting facility are left out: it already has them.
 */
class RemoteHistoryAssembler {

	/** Everything the response may ever contain. Anything else is a scope breach (ADR 0013 §4). */
	static final List<String> RESOURCE_TYPES = Collections.unmodifiableList(java.util.Arrays.asList("AllergyIntolerance",
	    "Condition", "MedicationRequest", "Immunization", "EpisodeOfCare", "Observation", "Encounter"));

	/** Tags the two ANC contact summary observations, the only Observations the response carries. */
	static final String ANC_SUMMARY_TAG = "anc-contact-summary";

	static final String STATE_EXTENSION = "https://liberiaemr.moh.gov.lr/fhir/StructureDefinition/programme-current-state";

	/** One patient record and what central holds against it. */
	static class Record {

		final Patient patient;

		final List<Allergy> allergies = new ArrayList<Allergy>();

		final List<Condition> activeConditions = new ArrayList<Condition>();

		final List<DrugOrder> activeDrugOrders = new ArrayList<DrugOrder>();

		/** Immunization history obs groups (CIEL 1421). */
		final List<Obs> immunizations = new ArrayList<Obs>();

		final List<PatientProgram> programmes = new ArrayList<PatientProgram>();

		final List<Encounter> encounters = new ArrayList<Encounter>();

		Record(Patient patient) {
			this.patient = patient;
		}
	}

	/** The content UUIDs the scope is defined by, and the MOH's sensitive-category exclusions. */
	static class Scope {

		Set<String> programmeUuids = Collections.emptySet();

		Set<String> ancEncounterTypeUuids = Collections.emptySet();

		String gestationalAgeConceptUuid;

		String nextContactConceptUuid;

		String vaccineConceptUuid;

		String vaccinationDateConceptUuid;

		/** Concepts the MOH names as sensitive: a record coded with one is never returned. */
		Set<String> excludedConceptUuids = Collections.emptySet();
	}

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private final FacilityResolver facilities;

	private final Scope scope;

	RemoteHistoryAssembler(FacilityResolver facilities, Scope scope) {
		this.facilities = facilities;
		this.scope = scope;
	}

	/**
	 * @param patientUuid the patient asked about
	 * @param records that patient's record and every record linked to the same CPI; empty when
	 *            central does not know the patient
	 * @param requestingFacility the facility asking (its records are left out), or null
	 * @return {@code {patientUuid, generatedAt, sources: [{sourceFacilityUuid, sourceFacilityName,
	 *         bundle}]}}; {@code sources} is empty, never absent, when nothing is visible
	 */
	ObjectNode assemble(String patientUuid, List<Record> records, Location requestingFacility, Date now) {
		Location requesting = requestingFacility == null ? null : facilities.facilityOf(requestingFacility);
		Map<String, Source> sources = new LinkedHashMap<String, Source>();

		for (Record record : records) {
			Location home = facilityOf(record.patient);
			for (Allergy allergy : record.allergies) {
				if (allergy.getAllergen() != null && excluded(allergy.getAllergen().getCodedAllergen())) {
					continue;
				}
				add(sources, requesting, facilityOf(allergy.getEncounter(), home), allergyIntolerance(allergy));
			}
			for (Condition condition : record.activeConditions) {
				if (condition.getCondition() != null && excluded(condition.getCondition().getCoded())) {
					continue;
				}
				add(sources, requesting, facilityOf(condition.getEncounter(), home), condition(condition));
			}
			for (DrugOrder order : record.activeDrugOrders) {
				if (excluded(order.getConcept())) {
					continue;
				}
				add(sources, requesting, facilityOf(order.getEncounter(), home), medicationRequest(order));
			}
			for (Obs group : record.immunizations) {
				Obs vaccine = member(group, scope.vaccineConceptUuid);
				if (vaccine == null || excluded(vaccine.getValueCoded())) {
					continue;
				}
				Location at = group.getLocation() != null ? facilities.facilityOf(group.getLocation())
				        : facilityOf(group.getEncounter(), home);
				add(sources, requesting, at, immunization(group, vaccine));
			}
			for (PatientProgram programme : record.programmes) {
				if (programme.getProgram() == null || !scope.programmeUuids.contains(programme.getProgram().getUuid())
				        || excluded(programme.getProgram().getConcept())) {
					continue;
				}
				Location at = programme.getLocation() != null ? facilities.facilityOf(programme.getLocation()) : home;
				add(sources, requesting, at, episodeOfCare(programme));
			}
			Encounter lastAnc = null;
			for (Encounter encounter : record.encounters) {
				add(sources, requesting, facilityOf(encounter, home), encounterIndex(encounter));
				if (encounter.getEncounterType() != null
				        && scope.ancEncounterTypeUuids.contains(encounter.getEncounterType().getUuid())
				        && (lastAnc == null || after(encounter, lastAnc))) {
					lastAnc = encounter;
				}
			}
			if (lastAnc != null) {
				Location at = facilityOf(lastAnc, home);
				for (ObjectNode summary : ancContactSummary(lastAnc)) {
					add(sources, requesting, at, summary);
				}
			}
		}

		ObjectNode out = MAPPER.createObjectNode();
		out.put("patientUuid", patientUuid);
		out.put("generatedAt", iso(now));
		ArrayNode list = out.putArray("sources");
		for (Source source : sources.values()) {
			ObjectNode node = list.addObject();
			node.put("sourceFacilityUuid", source.uuid);
			node.put("sourceFacilityName", source.name);
			ObjectNode bundle = node.putObject("bundle");
			bundle.put("resourceType", "Bundle");
			bundle.put("type", "collection");
			ArrayNode entries = bundle.putArray("entry");
			for (ObjectNode resource : source.resources) {
				entries.addObject().set("resource", resource);
			}
		}
		return out;
	}

	private static class Source {

		final String uuid;

		final String name;

		final List<ObjectNode> resources = new ArrayList<ObjectNode>();

		Source(Location facility) {
			this.uuid = facility == null ? null : facility.getUuid();
			this.name = facility == null ? null : facility.getName();
		}
	}

	private static void add(Map<String, Source> sources, Location requesting, Location facility, ObjectNode resource) {
		if (requesting != null && facility != null && requesting.getUuid().equals(facility.getUuid())) {
			return;
		}
		String key = facility == null ? "" : facility.getUuid();
		Source source = sources.get(key);
		if (source == null) {
			source = new Source(facility);
			sources.put(key, source);
		}
		source.resources.add(resource);
	}

	private Location facilityOf(Patient patient) {
		PatientIdentifier identifier = patient == null ? null : patient.getPatientIdentifier();
		return identifier == null || identifier.getLocation() == null ? null
		        : facilities.facilityOf(identifier.getLocation());
	}

	private Location facilityOf(Encounter encounter, Location fallback) {
		if (encounter != null && encounter.getLocation() != null) {
			Location facility = facilities.facilityOf(encounter.getLocation());
			if (facility != null) {
				return facility;
			}
		}
		return fallback;
	}

	private boolean excluded(Concept concept) {
		return concept != null && scope.excludedConceptUuids.contains(concept.getUuid());
	}

	private static boolean after(Encounter a, Encounter b) {
		return a.getEncounterDatetime() != null
		        && (b.getEncounterDatetime() == null || a.getEncounterDatetime().after(b.getEncounterDatetime()));
	}

	// --- resources --------------------------------------------------------------------------------

	private ObjectNode allergyIntolerance(Allergy allergy) {
		ObjectNode r = resource("AllergyIntolerance", allergy.getUuid(), allergy.getPatient());
		r.putObject("clinicalStatus").putArray("coding").addObject().put("code", "active");
		if (allergy.getAllergen() != null) {
			r.set("code", codeable(allergy.getAllergen().getCodedAllergen(), allergy.getAllergen().getNonCodedAllergen()));
			if (allergy.getAllergen().getAllergenType() != null) {
				r.putArray("category").add(allergy.getAllergen().getAllergenType().name().toLowerCase(java.util.Locale.ROOT));
			}
		}
		if (allergy.getSeverity() != null) {
			r.put("criticality", name(allergy.getSeverity()));
		}
		if (allergy.getReactions() != null && !allergy.getReactions().isEmpty()) {
			ArrayNode manifestation = r.putArray("reaction").addObject().putArray("manifestation");
			for (AllergyReaction reaction : allergy.getReactions()) {
				manifestation.add(codeable(reaction.getReaction(), reaction.getReactionNonCoded()));
			}
		}
		putDate(r, "recordedDate", allergy.getDateCreated());
		return r;
	}

	private ObjectNode condition(Condition condition) {
		ObjectNode r = resource("Condition", condition.getUuid(), condition.getPatient());
		r.putObject("clinicalStatus").putArray("coding").addObject().put("code", "active");
		if (condition.getCondition() != null) {
			r.set("code", codeable(condition.getCondition().getCoded(), condition.getCondition().getNonCoded()));
		}
		putDate(r, "onsetDateTime", condition.getOnsetDate());
		putDate(r, "recordedDate", condition.getDateCreated());
		return r;
	}

	private ObjectNode medicationRequest(DrugOrder order) {
		ObjectNode r = resource("MedicationRequest", order.getUuid(), order.getPatient());
		r.put("status", "active");
		r.put("intent", "order");
		String drug = order.getDrug() != null ? order.getDrug().getName() : order.getDrugNonCoded();
		r.set("medicationCodeableConcept", codeable(order.getConcept(), drug));
		putDate(r, "authoredOn", order.getDateActivated());
		String dosing = dosing(order);
		if (dosing != null) {
			r.putArray("dosageInstruction").addObject().put("text", dosing);
		}
		return r;
	}

	private ObjectNode immunization(Obs group, Obs vaccine) {
		ObjectNode r = resource("Immunization", group.getUuid(), (Patient) null);
		r.putObject("patient").put("reference", "Patient/" + group.getPerson().getUuid());
		r.put("status", "completed");
		r.set("vaccineCode", codeable(vaccine.getValueCoded(), null));
		Obs date = member(group, scope.vaccinationDateConceptUuid);
		putDate(r, "occurrenceDateTime", date != null && date.getValueDatetime() != null ? date.getValueDatetime()
		        : group.getObsDatetime());
		return r;
	}

	private ObjectNode episodeOfCare(PatientProgram programme) {
		ObjectNode r = resource("EpisodeOfCare", programme.getUuid(), programme.getPatient());
		r.put("status", programme.getDateCompleted() == null ? "active" : "finished");
		r.putArray("type").add(codeable(programme.getProgram().getConcept(), programme.getProgram().getName()));
		ObjectNode period = r.putObject("period");
		putDate(period, "start", programme.getDateEnrolled());
		putDate(period, "end", programme.getDateCompleted());
		if (programme.getCurrentStates() != null) {
			for (PatientState state : programme.getCurrentStates()) {
				if (state.getState() != null && state.getState().getConcept() != null) {
					ObjectNode extension = r.withArray("extension").addObject();
					extension.put("url", STATE_EXTENSION);
					extension.put("valueString", name(state.getState().getConcept()));
				}
			}
		}
		return r;
	}

	/** An encounter index row: date, type and facility, never its observations. */
	private ObjectNode encounterIndex(Encounter encounter) {
		ObjectNode r = resource("Encounter", encounter.getUuid(), null);
		r.putObject("subject").put("reference", "Patient/" + encounter.getPatient().getUuid());
		r.put("status", "finished");
		if (encounter.getEncounterType() != null) {
			r.putArray("type").addObject().put("text", encounter.getEncounterType().getName());
		}
		putDate(r.putObject("period"), "start", encounter.getEncounterDatetime());
		if (encounter.getLocation() != null) {
			r.putArray("location").addObject().putObject("location").put("display", encounter.getLocation().getName());
		}
		return r;
	}

	/** Gestational age and next contact from the last ANC encounter, tagged as the contact summary. */
	private List<ObjectNode> ancContactSummary(Encounter encounter) {
		List<ObjectNode> out = new ArrayList<ObjectNode>();
		for (Obs obs : encounter.getAllObs(false)) {
			String concept = obs.getConcept() == null ? null : obs.getConcept().getUuid();
			boolean gestationalAge = concept != null && concept.equals(scope.gestationalAgeConceptUuid);
			boolean nextContact = concept != null && concept.equals(scope.nextContactConceptUuid);
			if (!gestationalAge && !nextContact) {
				continue;
			}
			ObjectNode r = resource("Observation", obs.getUuid(), null);
			r.putObject("meta").putArray("tag").addObject().put("code", ANC_SUMMARY_TAG);
			r.putObject("subject").put("reference", "Patient/" + encounter.getPatient().getUuid());
			r.put("status", "final");
			r.set("code", codeable(obs.getConcept(), null));
			r.putObject("encounter").put("reference", "Encounter/" + encounter.getUuid());
			putDate(r, "effectiveDateTime", obs.getObsDatetime());
			if (gestationalAge && obs.getValueNumeric() != null) {
				ObjectNode quantity = r.putObject("valueQuantity");
				quantity.put("value", obs.getValueNumeric());
				quantity.put("unit", "weeks");
			}
			else if (nextContact && obs.getValueDatetime() != null) {
				putDate(r, "valueDateTime", obs.getValueDatetime());
			}
			out.add(r);
		}
		return out;
	}

	// --- helpers ----------------------------------------------------------------------------------

	private static ObjectNode resource(String type, String uuid, Patient patient) {
		ObjectNode r = MAPPER.createObjectNode();
		r.put("resourceType", type);
		r.put("id", uuid);
		if (patient != null) {
			r.putObject("AllergyIntolerance".equals(type) ? "patient" : "subject").put("reference",
			    "Patient/" + patient.getUuid());
		}
		return r;
	}

	private static ObjectNode codeable(Concept concept, String text) {
		ObjectNode node = MAPPER.createObjectNode();
		if (concept != null) {
			node.putArray("coding").addObject().put("code", concept.getUuid()).put("display", name(concept));
		}
		String shown = text != null && !text.trim().isEmpty() ? text : name(concept);
		if (shown != null) {
			node.put("text", shown);
		}
		return node;
	}

	private static Obs member(Obs group, String conceptUuid) {
		if (group.getGroupMembers() == null || conceptUuid == null) {
			return null;
		}
		for (Obs member : group.getGroupMembers()) {
			if (!member.getVoided() && member.getConcept() != null && conceptUuid.equals(member.getConcept().getUuid())) {
				return member;
			}
		}
		return null;
	}

	private static String dosing(DrugOrder order) {
		StringBuilder text = new StringBuilder();
		if (order.getDose() != null) {
			text.append(order.getDose() % 1 == 0 ? String.valueOf(order.getDose().longValue()) : order.getDose().toString());
			if (order.getDoseUnits() != null) {
				text.append(' ').append(name(order.getDoseUnits()));
			}
		}
		if (order.getFrequency() != null && order.getFrequency().getConcept() != null) {
			text.append(text.length() > 0 ? ", " : "").append(name(order.getFrequency().getConcept()));
		}
		if (order.getDosingInstructions() != null && !order.getDosingInstructions().trim().isEmpty()) {
			text.append(text.length() > 0 ? ". " : "").append(order.getDosingInstructions().trim());
		}
		return text.length() == 0 ? null : text.toString();
	}

	/**
	 * A concept's name without an OpenMRS context: the preferred English name, else a fully
	 * specified one, else any.
	 */
	static String name(Concept concept) {
		if (concept == null || concept.getNames() == null) {
			return null;
		}
		ConceptName chosen = null;
		for (ConceptName name : concept.getNames()) {
			if (name.getVoided() != null && name.getVoided()) {
				continue;
			}
			boolean english = name.getLocale() != null && "en".equals(name.getLocale().getLanguage());
			if (english && Boolean.TRUE.equals(name.getLocalePreferred())) {
				return name.getName();
			}
			if (chosen == null || (english && Boolean.TRUE.equals(name.isFullySpecifiedName()))) {
				chosen = name;
			}
		}
		return chosen == null ? null : chosen.getName();
	}

	private static void putDate(ObjectNode node, String field, Date date) {
		if (date != null) {
			node.put(field, iso(date));
		}
	}

	static String iso(Date date) {
		SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
		format.setTimeZone(TimeZone.getTimeZone("UTC"));
		return format.format(date);
	}
}
