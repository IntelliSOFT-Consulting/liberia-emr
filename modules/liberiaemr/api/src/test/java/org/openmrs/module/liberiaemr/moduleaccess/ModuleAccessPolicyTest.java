/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.moduleaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import org.junit.Test;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Obs;
import org.openmrs.OrderType;
import org.openmrs.TestOrder;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessPolicy.Verdict;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership;

/** Decisions for the matrix, relabeling, exclusions and ambiguous provenance. No database. */
public class ModuleAccessPolicyTest {
	private final ModuleRecordClassifier classifier = new ModuleRecordClassifier();

	private static String uuid(String key) { return ContentUuids.get("var." + key + ".uuid"); }

	private Ownership encounter(String form, String type) {
		String formUuid = form == null ? null : uuid("form." + form);
		String typeUuid = type == null ? null : uuid(type);
		return classifier.assessEncounterIdentity(formUuid, typeUuid, typeUuid);
	}

	@Test public void laborAndDeliveryMatchesMercysRow() {
		Ownership labor = encounter("first-and-second-stage-of-labor-and-delivery", "encountertype.labor-delivery");
		assertEquals(ModuleAccess.LABOR_AND_DELIVERY, labor.module);
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.read(labor, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(labor, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.update(labor, labor, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.read(labor, ModuleAccess.LABOR_AND_DELIVERY.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(labor, ModuleAccess.LABOR_AND_DELIVERY.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.update(labor, labor, ModuleAccess.LABOR_AND_DELIVERY.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.destroy(labor, ModuleAccess.LABOR_AND_DELIVERY.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.read(labor, Collections.<String>emptySet()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(labor, Collections.<String>emptySet()));
	}

	@Test public void genericEncounterPrivilegesDoNotAuthorizeLaborAndDelivery() {
		Ownership labor = encounter("partograph", "encountertype.labor-delivery");
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(labor, new HashSet<>(Arrays.asList("Add Encounters", "Edit Encounters", "Add Observations"))));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.read(labor, new HashSet<>(Arrays.asList("Get Encounters", "Get Observations"))));
	}

	@Test public void callerCannotRelabelLaborIntoConsultationOrVitals() {
		Ownership labor = encounter("partograph", "encountertype.labor-delivery");
		Ownership consultation = encounter("opd-consultation", "encountertype.consultation");
		Ownership vitals = encounter(null, "encountertype.vitals");
		assertEquals(Verdict.DENY, ModuleAccessPolicy.update(labor, consultation, ModuleAccess.GENERAL_CONSULTATION.writePrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.update(labor, vitals, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.update(vitals, labor, Collections.<String>emptySet()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.update(vitals, labor, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
	}

	@Test public void mismatchedFormAndServerEncounterTypeIsDenied() {
		String form = uuid("form.partograph");
		Ownership mismatched = classifier.assessEncounterIdentity(form, uuid("encountertype.labor-delivery"), uuid("encountertype.vitals"));
		assertTrue(mismatched.ambiguous);
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(mismatched, ModuleAccess.LABOR_AND_DELIVERY.writePrivileges()));
	}

	@Test public void vitalsStayExcludedWithOrdersAttached() {
		Ownership vitals = encounter(null, "encountertype.vitals");
		assertTrue(vitals.excluded);
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(vitals, Collections.<String>emptySet()));
		Encounter encounter = new Encounter();
		encounter.setEncounterType(new EncounterType());
		encounter.getEncounterType().setUuid(uuid("encountertype.vitals"));
		Obs obs = new Obs();
		obs.setEncounter(encounter);
		TestOrder order = new TestOrder();
		order.setOrderType(new OrderType());
		order.getOrderType().setUuid(OrderType.TEST_ORDER_TYPE_UUID);
		obs.setOrder(order);
		assertTrue(classifier.assessObservation(obs).excluded);
		assertEquals(ModuleAccess.LABORATORY, classifier.assessOrder(order).module);
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(classifier.assessOrder(order), Collections.<String>emptySet()));
		DrugOrder drug = new DrugOrder();
		drug.setOrderType(new OrderType());
		drug.getOrderType().setUuid(OrderType.DRUG_ORDER_TYPE_UUID);
		obs.setOrder(drug);
		assertTrue(classifier.assessObservation(obs).excluded);
		assertEquals(ModuleAccess.PHARMACY, classifier.assessOrder(drug).module);
	}

	@Test public void triageAndAppointmentsAreNotProtectedModules() {
		assertTrue(encounter("triage", "encountertype.triage").excluded);
		assertTrue(encounter(null, "encountertype.triage").excluded);
		assertTrue(classifier.appointment().excluded);
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(Ownership.excluded(), Collections.<String>emptySet()));
		assertTrue(encounter(null, "encountertype.consultation").isUnrelated());
	}

	@Test public void ambiguousProvenanceNeverAllows() {
		Ownership conflict = classifier.assessEncounterIdentity(uuid("form.opd-consultation"), uuid("encountertype.vitals"), uuid("encountertype.vitals"));
		assertTrue(conflict.ambiguous);
		assertEquals(Verdict.DENY, ModuleAccessPolicy.read(conflict, ModuleAccess.GENERAL_CONSULTATION.writePrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(conflict, ModuleAccess.GENERAL_CONSULTATION.writePrivileges()));
	}

	@Test public void immunizationReadDoesNotImplyWriteAndLaboratoryIsNotPharmacy() {
		Ownership immunization = encounter("immunization", "encountertype.consultation");
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.read(immunization, ModuleAccess.IMMUNIZATION.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(immunization, ModuleAccess.IMMUNIZATION.readPrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(immunization, ModuleAccess.IMMUNIZATION.writePrivileges()));
		TestOrder test = new TestOrder();
		test.setOrderType(new OrderType());
		test.getOrderType().setUuid(OrderType.TEST_ORDER_TYPE_UUID);
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(classifier.assessOrder(test), ModuleAccess.LABORATORY.writePrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(classifier.assessOrder(test), ModuleAccess.PHARMACY.writePrivileges()));
		DrugOrder drug = new DrugOrder();
		drug.setOrderType(new OrderType());
		drug.getOrderType().setUuid(OrderType.DRUG_ORDER_TYPE_UUID);
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(classifier.assessOrder(drug), ModuleAccess.PHARMACY.writePrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(classifier.assessOrder(drug), ModuleAccess.LABORATORY.writePrivileges()));
		assertFalse(classifier.assessDispense(null).module == ModuleAccess.PHARMACY);
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(classifier.assessDispense(null), ModuleAccess.PHARMACY.writePrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(classifier.assessDispense(drug), ModuleAccess.PHARMACY.writePrivileges()));
	}

	@Test public void tbMidwifeIsReadOnlyAndNurseCanWrite() {
		Ownership tb = encounter("tb-screening", "encountertype.tb-screening");
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.create(tb, ModuleAccess.TB_SCREENING.writePrivileges()));
		assertEquals(Verdict.ALLOW, ModuleAccessPolicy.read(tb, ModuleAccess.TB_SCREENING.readPrivileges()));
		assertEquals(Verdict.DENY, ModuleAccessPolicy.create(tb, ModuleAccess.TB_SCREENING.readPrivileges()));
	}
}
