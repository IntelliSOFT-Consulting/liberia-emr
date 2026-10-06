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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Allergen;
import org.openmrs.AllergenType;
import org.openmrs.Allergy;
import org.openmrs.CodedOrFreeText;
import org.openmrs.Concept;
import org.openmrs.ConceptName;
import org.openmrs.Condition;
import org.openmrs.ConditionClinicalStatus;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Location;
import org.openmrs.LocationTag;
import org.openmrs.Obs;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientProgram;
import org.openmrs.PatientState;
import org.openmrs.Program;
import org.openmrs.ProgramWorkflowState;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The LE-382 scope and attribution rules on plain objects: one test per entity type, each checking
 * the facility the record is attributed to.
 */
public class RemoteHistoryAssemblerTest {

	private static final String TAG = "tag-health-facility";

	private static final String ANC = "program-anc";

	private static final String ANC_INITIAL = "encountertype-anc-initial";

	private static final String GA = "concept-ga";

	private static final String NEXT = "concept-next-anc";

	private static final String VACCINE = "concept-vaccine";

	private static final String VACCINE_DATE = "concept-vaccine-date";

	private static final Date NOW = new Date();

	private Location county;

	/** Careysburg Health Center and its OPD ward, which sits under it. */
	private Location careysburg;

	private Location careysburgOpd;

	private Location barnersville;

	private Patient patient;

	private RemoteHistoryAssembler.Scope scope;

	private RemoteHistoryAssembler assembler;

	@Before
	public void setUp() {
		county = location("county", null, false);
		careysburg = location("careysburg", county, true);
		careysburgOpd = location("careysburg-opd", careysburg, false);
		barnersville = location("barnersville", county, true);

		patient = patient("patient-1", careysburgOpd);

		scope = new RemoteHistoryAssembler.Scope();
		scope.programmeUuids = new HashSet<String>(Collections.singletonList(ANC));
		scope.ancEncounterTypeUuids = new HashSet<String>(Collections.singletonList(ANC_INITIAL));
		scope.gestationalAgeConceptUuid = GA;
		scope.nextContactConceptUuid = NEXT;
		scope.vaccineConceptUuid = VACCINE;
		scope.vaccinationDateConceptUuid = VACCINE_DATE;
		assembler = new RemoteHistoryAssembler(new FacilityResolver(TAG), scope);
	}

	// --- fixtures ---------------------------------------------------------------------------------

	private static Location location(String uuid, Location parent, boolean facility) {
		Location location = new Location();
		location.setUuid(uuid);
		location.setName(uuid);
		location.setParentLocation(parent);
		if (facility) {
			LocationTag tag = new LocationTag();
			tag.setUuid(TAG);
			location.addTag(tag);
		}
		return location;
	}

	private static Patient patient(String uuid, Location registeredAt) {
		Patient patient = new Patient();
		patient.setUuid(uuid);
		PatientIdentifier identifier = new PatientIdentifier();
		identifier.setIdentifier("ID-" + uuid);
		identifier.setLocation(registeredAt);
		identifier.setPreferred(true);
		patient.addIdentifier(identifier);
		return patient;
	}

	private static Concept concept(String uuid, String name) {
		Concept concept = new Concept();
		concept.setUuid(uuid);
		ConceptName conceptName = new ConceptName(name, Locale.ENGLISH);
		conceptName.setLocalePreferred(true);
		concept.setNames(new HashSet<ConceptName>(Collections.singletonList(conceptName)));
		return concept;
	}

	private Encounter encounter(String uuid, String typeUuid, Location at, Date when) {
		Encounter encounter = new Encounter();
		encounter.setUuid(uuid);
		encounter.setPatient(patient);
		EncounterType type = new EncounterType();
		type.setUuid(typeUuid);
		type.setName(typeUuid);
		encounter.setEncounterType(type);
		encounter.setLocation(at);
		encounter.setEncounterDatetime(when);
		return encounter;
	}

	private ObjectNode assemble(Location requesting, RemoteHistoryAssembler.Record... records) {
		return assembler.assemble(patient.getUuid(), Arrays.asList(records), requesting, NOW);
	}

	/** The single resource of the given type, and the facility its source is attributed to. */
	private static JsonNode only(ObjectNode out, String type, String[] facility) {
		JsonNode found = null;
		for (JsonNode source : out.path("sources")) {
			for (JsonNode entry : source.path("bundle").path("entry")) {
				if (type.equals(entry.path("resource").path("resourceType").asText())) {
					assertNull("more than one " + type, found);
					found = entry.path("resource");
					facility[0] = source.path("sourceFacilityUuid").isNull() ? null
					        : source.path("sourceFacilityUuid").asText();
				}
			}
		}
		assertNotNull("no " + type, found);
		return found;
	}

	private static List<String> types(ObjectNode out) {
		List<String> types = new ArrayList<String>();
		for (JsonNode source : out.path("sources")) {
			for (JsonNode entry : source.path("bundle").path("entry")) {
				types.add(entry.path("resource").path("resourceType").asText());
			}
		}
		return types;
	}

	// --- one test per entity type, with attribution -----------------------------------------------

	@Test
	public void allergiesAreAttributedToTheRecordsFacility() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Allergy allergy = new Allergy(patient, new Allergen(AllergenType.DRUG, concept("penicillin", "Penicillin"), null),
		        concept("severe", "Severe"), null, null);
		record.allergies.add(allergy);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "AllergyIntolerance", facility);

		assertEquals("careysburg", facility[0]);
		assertEquals("Patient/patient-1", resource.path("patient").path("reference").asText());
		assertEquals("Penicillin", resource.path("code").path("text").asText());
		assertEquals("drug", resource.path("category").get(0).asText());
		assertEquals("Severe", resource.path("criticality").asText());
	}

	@Test
	public void activeConditionsAreAttributedToTheirEncountersFacility() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Condition condition = new Condition();
		condition.setPatient(patient);
		condition.setCondition(new CodedOrFreeText(concept("malaria", "Malaria"), null, null));
		condition.setClinicalStatus(ConditionClinicalStatus.ACTIVE);
		condition.setEncounter(encounter("enc-b", "consultation", barnersville, NOW));
		record.activeConditions.add(condition);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "Condition", facility);

		assertEquals("barnersville", facility[0]);
		assertEquals("Malaria", resource.path("code").path("text").asText());
		assertEquals("malaria", resource.path("code").path("coding").get(0).path("code").asText());
	}

	@Test
	public void currentMedicationsBecomeMedicationRequests() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		DrugOrder order = new DrugOrder();
		order.setPatient(patient);
		order.setConcept(concept("amoxicillin", "Amoxicillin"));
		order.setDose(500.0);
		order.setDoseUnits(concept("mg", "mg"));
		order.setEncounter(encounter("enc-c", "order", careysburgOpd, NOW));
		record.activeDrugOrders.add(order);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "MedicationRequest", facility);

		assertEquals("careysburg", facility[0]);
		assertEquals("active", resource.path("status").asText());
		assertEquals("Amoxicillin", resource.path("medicationCodeableConcept").path("text").asText());
		assertEquals("500 mg", resource.path("dosageInstruction").get(0).path("text").asText());
	}

	@Test
	public void immunisationsComeFromTheHistoryGroups() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Obs group = new Obs();
		group.setPerson(patient);
		group.setConcept(concept("immunization-history", "Immunization history"));
		group.setLocation(barnersville);
		group.setObsDatetime(NOW);
		Obs vaccine = new Obs();
		vaccine.setConcept(concept(VACCINE, "Immunizations"));
		vaccine.setValueCoded(concept("bcg", "BCG"));
		group.addGroupMember(vaccine);
		record.immunizations.add(group);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "Immunization", facility);

		assertEquals("barnersville", facility[0]);
		assertEquals("BCG", resource.path("vaccineCode").path("text").asText());
		assertEquals("completed", resource.path("status").asText());
	}

	@Test
	public void mchProgrammeEnrolmentsCarryTheirCurrentState() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		PatientProgram enrolment = new PatientProgram();
		enrolment.setPatient(patient);
		Program anc = new Program();
		anc.setUuid(ANC);
		anc.setName("ANC");
		anc.setConcept(concept("anc", "Antenatal care"));
		enrolment.setProgram(anc);
		enrolment.setLocation(careysburg);
		enrolment.setDateEnrolled(new Date(NOW.getTime() - 86400000L));
		ProgramWorkflowState active = new ProgramWorkflowState();
		active.setConcept(concept("anc-active", "Active"));
		PatientState state = new PatientState();
		state.setState(active);
		state.setStartDate(new Date(NOW.getTime() - 86400000L));
		enrolment.getStates().add(state);
		state.setPatientProgram(enrolment);
		record.programmes.add(enrolment);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "EpisodeOfCare", facility);

		assertEquals("careysburg", facility[0]);
		assertEquals("active", resource.path("status").asText());
		assertEquals("Antenatal care", resource.path("type").get(0).path("coding").get(0).path("display").asText());
		assertEquals("Active", resource.path("extension").get(0).path("valueString").asText());
	}

	@Test
	public void programmesOutsideTheMchListAreLeftOut() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		PatientProgram hiv = new PatientProgram();
		hiv.setPatient(patient);
		Program program = new Program();
		program.setUuid("program-hiv");
		program.setConcept(concept("hiv", "HIV care"));
		hiv.setProgram(program);
		record.programmes.add(hiv);

		assertTrue(types(assemble(null, record)).isEmpty());
	}

	@Test
	public void encountersAreAnIndexWithoutObservations() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Encounter visit = encounter("enc-1", "consultation", barnersville, NOW);
		Obs temperature = new Obs();
		temperature.setConcept(concept("temp", "Temperature"));
		temperature.setValueNumeric(38.5);
		visit.addObs(temperature);
		record.encounters.add(visit);

		String[] facility = new String[1];
		JsonNode resource = only(assemble(null, record), "Encounter", facility);

		assertEquals("barnersville", facility[0]);
		assertEquals("consultation", resource.path("type").get(0).path("text").asText());
		assertTrue(resource.path("period").has("start"));
		assertFalse("an encounter index carries no observations", types(assemble(null, record)).contains("Observation"));
	}

	@Test
	public void theLastAncContactGivesGestationalAgeAndNextContact() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Encounter earlier = encounter("anc-1", ANC_INITIAL, careysburg, new Date(NOW.getTime() - 30L * 86400000L));
		Obs oldGa = new Obs();
		oldGa.setConcept(concept(GA, "Gestational age"));
		oldGa.setValueNumeric(20.0);
		earlier.addObs(oldGa);
		Encounter latest = encounter("anc-2", ANC_INITIAL, careysburg, NOW);
		Obs ga = new Obs();
		ga.setConcept(concept(GA, "Gestational age"));
		ga.setValueNumeric(24.0);
		latest.addObs(ga);
		Obs next = new Obs();
		next.setConcept(concept(NEXT, "Next ANC visit"));
		next.setValueDatetime(new Date(NOW.getTime() + 28L * 86400000L));
		latest.addObs(next);
		Obs other = new Obs();
		other.setConcept(concept("bp", "Systolic"));
		other.setValueNumeric(120.0);
		latest.addObs(other);
		record.encounters.add(earlier);
		record.encounters.add(latest);

		ObjectNode out = assemble(null, record);

		int summaries = 0;
		for (JsonNode source : out.path("sources")) {
			assertEquals("careysburg", source.path("sourceFacilityUuid").asText());
			for (JsonNode entry : source.path("bundle").path("entry")) {
				JsonNode resource = entry.path("resource");
				if ("Observation".equals(resource.path("resourceType").asText())) {
					summaries++;
					assertEquals(RemoteHistoryAssembler.ANC_SUMMARY_TAG, resource.path("meta").path("tag").get(0)
					        .path("code").asText());
					assertEquals("Encounter/anc-2", resource.path("encounter").path("reference").asText());
					if (resource.has("valueQuantity")) {
						assertEquals(24.0, resource.path("valueQuantity").path("value").asDouble(), 0.0);
					}
				}
			}
		}
		// GA and next contact from the latest ANC encounter only; the systolic BP is not in scope.
		assertEquals(2, summaries);
	}

	// --- rules across entity types ----------------------------------------------------------------

	@Test
	public void theRequestingFacilitysOwnRecordsAreLeftOut() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		record.encounters.add(encounter("at-careysburg", "consultation", careysburgOpd, NOW));
		record.encounters.add(encounter("at-barnersville", "consultation", barnersville, NOW));

		// Careysburg asks, naming its OPD ward: the whole Careysburg subtree is its own.
		ObjectNode out = assemble(careysburgOpd, record);

		assertEquals(1, out.path("sources").size());
		assertEquals("barnersville", out.path("sources").get(0).path("sourceFacilityUuid").asText());
		assertEquals(Collections.singletonList("Encounter"), types(out));
	}

	@Test
	public void cpiLinkedRecordsAreGathered() {
		Patient linked = patient("patient-2", barnersville);
		RemoteHistoryAssembler.Record own = new RemoteHistoryAssembler.Record(patient);
		own.encounters.add(encounter("enc-own", "consultation", careysburg, NOW));
		RemoteHistoryAssembler.Record other = new RemoteHistoryAssembler.Record(linked);
		Encounter atBarnersville = encounter("enc-linked", "consultation", barnersville, NOW);
		atBarnersville.setPatient(linked);
		other.encounters.add(atBarnersville);

		ObjectNode out = assemble(null, own, other);

		assertEquals(2, out.path("sources").size());
		assertEquals("patient-1", out.path("patientUuid").asText());
	}

	@Test
	public void sensitiveConceptsNamedByTheMohAreNeverReturned() {
		scope.excludedConceptUuids = new HashSet<String>(Collections.singletonList("hiv-disease"));
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		Condition condition = new Condition();
		condition.setPatient(patient);
		condition.setCondition(new CodedOrFreeText(concept("hiv-disease", "HIV disease"), null, null));
		record.activeConditions.add(condition);

		assertTrue(types(assemble(null, record)).isEmpty());
	}

	@Test
	public void nothingVisibleIsAnEmptyListNotAnError() {
		ObjectNode out = assembler.assemble("unknown", Collections.<RemoteHistoryAssembler.Record> emptyList(), null, NOW);

		assertEquals("unknown", out.path("patientUuid").asText());
		assertTrue(out.path("sources").isArray());
		assertEquals(0, out.path("sources").size());
	}

	@Test
	public void eachSourceIsACollectionBundleOfScopedTypesOnly() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		record.encounters.add(encounter("e", "consultation", barnersville, NOW));

		ObjectNode out = assemble(null, record);

		JsonNode bundle = out.path("sources").get(0).path("bundle");
		assertEquals("Bundle", bundle.path("resourceType").asText());
		assertEquals("collection", bundle.path("type").asText());
		for (String type : types(out)) {
			assertTrue(type + " is outside the ADR 0013 scope", RemoteHistoryAssembler.RESOURCE_TYPES.contains(type));
		}
	}

	@Test
	public void aRecordWithNoTaggedFacilityIsStillReturnedUnattributed() {
		Location orphan = location("orphan", null, false);
		Patient unplaced = patient("patient-3", orphan);
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(unplaced);
		Encounter encounter = encounter("e", "consultation", orphan, NOW);
		encounter.setPatient(unplaced);
		record.encounters.add(encounter);

		ObjectNode out = assembler.assemble("patient-3", Collections.singletonList(record), careysburg, NOW);

		assertEquals(1, out.path("sources").size());
		assertTrue(out.path("sources").get(0).path("sourceFacilityUuid").isNull());
	}

	@Test
	public void anAccessAuditRecordsWhoAskedWhyAndWhatLeftCentral() {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		record.encounters.add(encounter("e1", "consultation", barnersville, NOW));
		record.encounters.add(encounter("e2", "consultation", careysburg, NOW));
		ObjectNode out = assemble(null, record);

		java.util.Map<String, Object> details = RemoteHistoryService.accessDetails("requester", "referral in",
		    RemoteHistoryService.OUTCOME_SERVED, out);

		assertEquals("SERVED", details.get("outcome"));
		assertEquals("requester", details.get("requestingFacility"));
		assertEquals("referral in", details.get("reason"));
		assertEquals(2, details.get("resourceCount"));
		assertEquals(Arrays.asList("barnersville", "careysburg"), details.get("sourceFacilities"));
	}

	@Test
	public void aDeniedAccessIsAuditedWithNothingServed() {
		java.util.Map<String, Object> details = RemoteHistoryService.accessDetails(null, null,
		    RemoteHistoryService.OUTCOME_DENIED, null);

		assertEquals("DENIED", details.get("outcome"));
		assertEquals(0, details.get("resourceCount"));
		assertTrue(((List<?>) details.get("sourceFacilities")).isEmpty());
	}

	@Test
	public void excludedConceptsAreParsedFromTheGlobalProperty() {
		assertTrue(RemoteHistoryService.excludedConcepts(null).isEmpty());
		assertTrue(RemoteHistoryService.excludedConcepts("  ").isEmpty());
		assertEquals(new HashSet<String>(Arrays.asList("a", "b")), RemoteHistoryService.excludedConcepts(" a, ,b "));
	}
}
