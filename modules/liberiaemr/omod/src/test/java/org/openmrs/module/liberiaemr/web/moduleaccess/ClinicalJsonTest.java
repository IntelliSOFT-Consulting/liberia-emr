/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.moduleaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import org.junit.Test;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessPolicy;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessPolicy.Verdict;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier;

public class ClinicalJsonTest {
	private final ModuleRecordClassifier classifier = new ModuleRecordClassifier();

	@Test public void nurseVisitPayloadDropsALaboratoryEncounterAndKeepsVitals() {
		String lab = ContentUuids.get("var.encountertypes.lab-results.uuid");
		String vitals = ContentUuids.get("var.encountertype.vitals.uuid");
		String body = "{\"encounters\":["
		        + "{\"uuid\":\"lab\",\"encounterType\":{\"uuid\":\"" + lab + "\"},\"obs\":[{\"uuid\":\"hb\",\"display\":\"hemoglobin\"}]},"
		        + "{\"uuid\":\"vitals\",\"encounterType\":{\"uuid\":\"" + vitals + "\"},\"obs\":[{\"uuid\":\"pulse\",\"display\":\"pulse\"}]}"
		        + "]}";
		String filtered = ClinicalJson.filter(body, (kind, uuid, form, type) -> {
			if (!"encounter".equals(kind)) { return true; }
			return ModuleAccessPolicy.read(classifier.assessEncounterIdentity(form, type, type),
			    Collections.singleton("Write Labor and Delivery")) == Verdict.ALLOW;
		});
		assertFalse(filtered.contains("hemoglobin"));
		assertFalse(filtered.contains("\"uuid\":\"lab\""));
		assertTrue(filtered.contains("pulse"));
		assertTrue(filtered.contains("vitals"));
	}

	@Test public void physicianAssistantVisitPayloadKeepsReadableModulesAndDropsTheRest() {
		String pnc = ContentUuids.get("var.form.pnc-national.uuid");
		String immunization = ContentUuids.get("var.form.immunization.uuid");
		String consultation = ContentUuids.get("var.form.opd-consultation.uuid");
		String vitals = ContentUuids.get("var.encountertype.vitals.uuid");
		String type = ContentUuids.get("var.encountertype.consultation.uuid");
		String body = "{\"encounters\":["
		        + "{\"uuid\":\"pnc\",\"form\":{\"uuid\":\"" + pnc + "\"},\"encounterType\":{\"uuid\":\"" + type + "\"},\"obs\":[{\"uuid\":\"pnc-obs\",\"display\":\"pnc-note\"}]},"
		        + "{\"uuid\":\"shot\",\"form\":{\"uuid\":\"" + immunization + "\"},\"encounterType\":{\"uuid\":\"" + type + "\"},\"obs\":[{\"uuid\":\"shot-obs\",\"display\":\"vaccine\"}]},"
		        + "{\"uuid\":\"consult\",\"form\":{\"uuid\":\"" + consultation + "\"},\"encounterType\":{\"uuid\":\"" + type + "\"},\"obs\":[{\"uuid\":\"consult-obs\",\"display\":\"diagnosis\"}]},"
		        + "{\"uuid\":\"vitals\",\"encounterType\":{\"uuid\":\"" + vitals + "\"},\"obs\":[{\"uuid\":\"pulse-obs\",\"display\":\"pulse\"}]}"
		        + "]}";
		final java.util.Set<String> privileges = new HashSet<>(Arrays.asList("Manage General Consultation", "Manage ANC",
		        "Manage Laboratory", "Manage Pharmacy", "Read Labor and Delivery", "Read Immunization"));
		String filtered = ClinicalJson.filter(body, (kind, uuid, form, encounterType) -> {
			if (!"encounter".equals(kind)) { return true; }
			org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership ownership = classifier
			        .assessEncounterIdentity(form, encounterType, encounterType);
			boolean hadGenericRead = false;
			if (!hadGenericRead && (ownership.isUnrelated() || ownership.excluded)) { return false; }
			return ModuleAccessPolicy.read(ownership, privileges) == Verdict.ALLOW;
		});
		assertFalse(filtered.contains("pnc-note"));
		assertFalse(filtered.contains("\"uuid\":\"pnc\""));
		assertFalse(filtered.contains("pulse"));
		assertTrue(filtered.contains("vaccine"));
		assertTrue(filtered.contains("diagnosis"));
	}

	@Test public void fhirOrderBundleDropsTheModuleTheRoleCannotRead() {
		String body = "{\"resourceType\":\"Bundle\",\"entry\":["
		        + "{\"resource\":{\"resourceType\":\"ServiceRequest\",\"id\":\"lab-order\"}},"
		        + "{\"resource\":{\"resourceType\":\"MedicationRequest\",\"id\":\"drug-order\"}},"
		        + "{\"resource\":{\"resourceType\":\"Observation\",\"id\":\"vitals-obs\"}}"
		        + "]}";
		String pharmacist = ClinicalJson.filter(body, (kind, uuid, form, type) -> !"ServiceRequest".equals(kind));
		assertFalse(pharmacist.contains("lab-order"));
		assertTrue(pharmacist.contains("drug-order"));
		assertTrue(pharmacist.contains("vitals-obs"));
		String lab = ClinicalJson.filter(body, (kind, uuid, form, type) -> !"MedicationRequest".equals(kind));
		assertTrue(lab.contains("lab-order"));
		assertFalse(lab.contains("drug-order"));
	}

	@Test public void policyDeniesTheOrdersThoseFhirResourcesWouldLoad() {
		ModuleRecordClassifier classifier = this.classifier;
		org.openmrs.TestOrder test = new org.openmrs.TestOrder();
		test.setOrderType(new org.openmrs.OrderType());
		test.getOrderType().setUuid(org.openmrs.OrderType.TEST_ORDER_TYPE_UUID);
		org.openmrs.DrugOrder drug = new org.openmrs.DrugOrder();
		drug.setOrderType(new org.openmrs.OrderType());
		drug.getOrderType().setUuid(org.openmrs.OrderType.DRUG_ORDER_TYPE_UUID);
		assertTrue(ModuleAccessPolicy.read(classifier.assessOrder(test), ModuleAccess.PHARMACY.writePrivileges()) == Verdict.DENY);
		assertTrue(ModuleAccessPolicy.read(classifier.assessOrder(drug), ModuleAccess.LABORATORY.writePrivileges()) == Verdict.DENY);
		assertTrue(ModuleAccessPolicy.read(classifier.assessOrder(drug), ModuleAccess.PHARMACY.writePrivileges()) == Verdict.ALLOW);
		assertTrue(ModuleAccessPolicy.read(classifier.assessOrder(test), ModuleAccess.LABORATORY.writePrivileges()) == Verdict.ALLOW);
	}

	@Test public void unreadableClinicalContentFailsClosed() {
		String filtered = ClinicalJson.filter("{\"resourceType\":\"Bundle\",\"entry\":[{\"resource\":{\"resourceType\":\"Observation\"",
		    (kind, uuid, form, type) -> true);
		assertFalse(filtered.contains("Observation"));
		assertTrue(filtered.contains("entry"));
		assertEquals("{\"results\":[]}", ClinicalJson.filter("truncated sensitive content", (kind, uuid, form, type) -> true));
	}

	@Test public void fhirXmlCannotPassThroughOnAFilteredClinicalUrl() {
		String xml = "<Observation xmlns=\"http://hl7.org/fhir\"><id value=\"protected-result\"/>"
		        + "<valueString value=\"sensitive content\"/></Observation>";
		assertEquals("{\"results\":[]}", ClinicalJson.filter(xml, (kind, uuid, form, type) -> true));
	}

	@Test public void keeperFailureDropsTheClinicalRecord() {
		String body = "{\"resourceType\":\"Observation\",\"id\":\"protected-result\"}";
		assertFalse(ClinicalJson.filter(body, (kind, uuid, form, type) -> {
			throw new IllegalStateException("lookup failed");
		}).contains("protected-result"));
	}

	@Test public void corruptGzipFailsClosedAndValidGzipStillDecodes() throws Exception {
		java.lang.reflect.Method gunzip = ClinicalResponseFilter.class.getDeclaredMethod("gunzip", byte[].class);
		gunzip.setAccessible(true);
		byte[] plain = "{\"resourceType\":\"Observation\",\"id\":\"protected-result\"}"
		        .getBytes(java.nio.charset.StandardCharsets.UTF_8);
		java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
		try (java.util.zip.GZIPOutputStream zip = new java.util.zip.GZIPOutputStream(out)) { zip.write(plain); }
		byte[] compressed = out.toByteArray();
		org.junit.Assert.assertArrayEquals(plain, (byte[]) gunzip.invoke(null, (Object) compressed));
		byte[] truncated = Arrays.copyOf(compressed, compressed.length - 4);
		assertEquals("{\"results\":[]}", new String((byte[]) gunzip.invoke(null, (Object) truncated),
		    java.nio.charset.StandardCharsets.UTF_8));
	}

	@Test public void filterCoversDirectEncounterButNotObsOrdersMetadataOrAppointments() {
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/visit/uuid"));
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/fhir2/R4/ServiceRequest"));
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/fhir2/R4/MedicationRequest"));
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/fhir2/R4/Observation"));
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/encounter"));
		assertTrue(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/encounter/uuid"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/encountertype/uuid"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/encounterrole"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/obs/uuid"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/order/uuid"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/appointments/appointment"));
		assertFalse(ClinicalResponseFilter.interesting("/openmrs/ws/rest/v1/patient/uuid"));
	}

	// Direct /encounter payloads: nested records are decided on their own module, as a direct read would be.
	private static final String LAB = "lab-order", DRUG = "drug-order", RESULT = "lab-result", PLAIN = "plain-obs",
	        FP = "fp-obs";

	private String encounter(String typeUuid, String nested) {
		return "{\"results\":[{\"uuid\":\"enc\",\"encounterType\":{\"uuid\":\"" + typeUuid + "\"},"
		        + "\"display\":\"kept-encounter\"," + nested + "}]}";
	}

	private ClinicalJson.Keeper role(String... privileges) {
		java.util.Set<String> held = new java.util.HashSet<>(java.util.Arrays.asList(privileges));
		return (kind, uuid, form, type) -> {
			if ("encounter".equals(kind)) {
				return ModuleAccessPolicy.read(classifier.assessEncounterIdentity(form, type, type), held) == Verdict.ALLOW;
			}
			ModuleAccess module = LAB.equals(uuid) || RESULT.equals(uuid) ? ModuleAccess.LABORATORY
			        : DRUG.equals(uuid) ? ModuleAccess.PHARMACY : FP.equals(uuid) ? ModuleAccess.FAMILY_PLANNING : null;
			return module == null || module.allows(held, ModuleAccess.Access.READ);
		};
	}

	private String consultation() {
		return encounter("unrelated-order-encounter", "\"orders\":[{\"uuid\":\"" + LAB + "\",\"display\":\"malaria-smear\"},"
		        + "{\"uuid\":\"" + DRUG + "\",\"display\":\"amoxicillin\"}],"
		        + "\"obs\":[{\"uuid\":\"" + RESULT + "\",\"display\":\"smear-result\"},{\"uuid\":\"" + PLAIN + "\",\"display\":\"note\"}]");
	}

	@Test public void directEncounterDropsNestedRecordsEachRoleCannotRead() {
		String nurse = ClinicalJson.filter(consultation(), role("Write Labor and Delivery", "Manage Pharmacy"));
		assertFalse(nurse.contains("malaria-smear"));
		assertFalse(nurse.contains("smear-result"));
		assertTrue(nurse.contains("amoxicillin"));
		assertTrue(nurse.contains("note"));
		assertTrue(nurse.contains("kept-encounter"));
		String pharmacist = ClinicalJson.filter(consultation(), role("Manage Pharmacy"));
		assertFalse(pharmacist.contains("malaria-smear"));
		assertTrue(pharmacist.contains("amoxicillin"));
		String technician = ClinicalJson.filter(consultation(), role("Manage Laboratory"));
		assertTrue(technician.contains("malaria-smear"));
		assertTrue(technician.contains("smear-result"));
		assertFalse(technician.contains("amoxicillin"));
	}

	@Test public void physicianAssistantReadsLaborButNotANestedFamilyPlanningRecord() {
		String labor = ContentUuids.get("var.encountertype.labor-delivery.uuid");
		String body = encounter(labor, "\"obs\":[{\"uuid\":\"" + FP + "\",\"display\":\"fp-method\"},"
		        + "{\"uuid\":\"" + PLAIN + "\",\"display\":\"cervix\"}]");
		String assistant = ClinicalJson.filter(body, role("Read Labor and Delivery", "Manage Laboratory", "Manage Pharmacy"));
		assertTrue(assistant.contains("kept-encounter"));
		assertTrue(assistant.contains("cervix"));
		assertFalse(assistant.contains("fp-method"));
	}

	@Test public void vitalsCannotCarryAProtectedOrderOrGroupMember() {
		String vitals = ContentUuids.get("var.encountertype.vitals.uuid");
		String body = encounter(vitals, "\"obs\":[{\"uuid\":\"" + PLAIN + "\",\"display\":\"pulse\","
		        + "\"order\":{\"uuid\":\"" + LAB + "\",\"display\":\"malaria-smear\"},"
		        + "\"groupMembers\":[{\"uuid\":\"" + RESULT + "\",\"display\":\"smear-result\"},"
		        + "{\"uuid\":\"bp\",\"display\":\"blood-pressure\"}]}]");
		String nurse = ClinicalJson.filter(body, role("Write Labor and Delivery", "Manage Pharmacy"));
		assertTrue(nurse.contains("pulse"));
		assertTrue(nurse.contains("blood-pressure"));
		assertFalse(nurse.contains("malaria-smear"));
		assertFalse(nurse.contains("smear-result"));
		assertTrue(ClinicalJson.filter(body, role("Manage Laboratory")).contains("malaria-smear"));
	}

	@Test public void aNestedRecordWithoutUuidCannotBeDecidedAndIsDropped() {
		String body = encounter("unrelated-order-encounter",
		    "\"orders\":[{\"display\":\"malaria-smear\"}],\"obs\":[{\"display\":\"smear-result\",\"value\":4}]");
		String filtered = ClinicalJson.filter(body, (kind, uuid, form, type) -> true);
		assertTrue(filtered.contains("kept-encounter"));
		assertFalse(filtered.contains("malaria-smear"));
		assertFalse(filtered.contains("smear-result"));
	}

	@Test public void unrelatedRestJsonIsUnchanged() {
		String body = "{\"results\":[{\"uuid\":\"t\",\"display\":\"Consultation\",\"retired\":false}]}";
		assertTrue(ClinicalJson.filter(body, (kind, uuid, form, type) -> false).contains("Consultation"));
	}
}
