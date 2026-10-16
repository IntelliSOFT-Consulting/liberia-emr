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
import org.junit.Test;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.EncounterType;
import org.openmrs.Form;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.OrderType;
import org.openmrs.TestOrder;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership;

/** Form, type, order, and observation-group ownership. No database. */
public class ModuleRecordClassifierTest {
	private final ModuleRecordClassifier classifier = new ModuleRecordClassifier();

	private static String uuid(String key) { return ContentUuids.get("var." + key + ".uuid"); }

	private Encounter encounter(String form, String type) {
		Encounter e = new Encounter();
		if (form != null) { Form f = new Form(); f.setUuid(uuid("form." + form)); e.setForm(f); }
		if (type != null) { EncounterType t = new EncounterType(); t.setUuid(uuid(type)); e.setEncounterType(t); }
		return e;
	}

	private Order order(boolean drug) {
		Order o = drug ? new DrugOrder() : new TestOrder();
		OrderType t = new OrderType();
		t.setUuid(drug ? OrderType.DRUG_ORDER_TYPE_UUID : OrderType.TEST_ORDER_TYPE_UUID);
		o.setOrderType(t);
		return o;
	}

	private Obs obs(Encounter encounter, Order order) {
		Obs o = new Obs();
		o.setEncounter(encounter);
		o.setOrder(order);
		return o;
	}

	@Test public void currentFormsRequireTheirEncounterType() {
		String[][] cases = {
		    { "TB_SCREENING", "tb-screening", "tb-screening" },
		    { "GENERAL_CONSULTATION", "opd-consultation", "consultation" },
		    { "ANC", "anc-initial", "anc-initial" }, { "ANC", "anc-followup", "anc-followup" },
		    { "ANC", "anc-national", "consultation" }, { "PNC", "pnc-visit", "mch-pnc" },
		    { "PNC", "newborn-pnc", "mch-pnc" }, { "PNC", "pnc-national", "consultation" },
		    { "FAMILY_PLANNING", "family-planning", "mch-family-planning" },
		    { "FAMILY_PLANNING", "family-planning-national", "consultation" },
		    { "IMMUNIZATION", "immunization", "consultation" }, { "IMMUNIZATION", "aefi", "consultation" },
		    { "LABOR_AND_DELIVERY", "first-and-second-stage-of-labor-and-delivery", "labor-delivery" },
		    { "LABOR_AND_DELIVERY", "partograph", "labor-delivery" },
		    { "LABOR_AND_DELIVERY", "third-stage-of-labor-and-delivery", "labor-delivery" },
		    { "LABOR_AND_DELIVERY", "fourth-stage-monitoring-for-woman-and-baby", "labor-delivery" }
		};
		for (String[] c : cases) {
			Ownership match = classifier.assessStoredEncounter(encounter(c[1], "encountertype." + c[2]));
			assertEquals(c[1], ModuleAccess.valueOf(c[0]), match.module);
			assertTrue(c[1], classifier.assessStoredEncounter(encounter(c[1], "encountertype.vitals")).ambiguous);
			assertTrue(c[1], classifier.assessStoredEncounter(encounter(c[1], null)).ambiguous);
		}
	}

	@Test public void dedicatedTypesClassifyFormlessEncountersAndConsultationAloneDoesNot() {
		String[][] cases = { { "TB_SCREENING", "tb-screening" }, { "ANC", "anc" }, { "ANC", "anc-initial" },
		    { "ANC", "anc-followup" }, { "PNC", "pnc" }, { "PNC", "mch-pnc" },
		    { "FAMILY_PLANNING", "family-planning" }, { "FAMILY_PLANNING", "mch-family-planning" },
		    { "LABOR_AND_DELIVERY", "labor-delivery" }, { "LABOR_AND_DELIVERY", "labour-admission" },
		    { "LABOR_AND_DELIVERY", "delivery" }, { "LABOR_AND_DELIVERY", "partograph" } };
		for (String[] c : cases) {
			assertEquals(ModuleAccess.valueOf(c[0]), classifier.assessStoredEncounter(encounter(null, "encountertype." + c[1])).module);
		}
		assertEquals(ModuleAccess.LABORATORY, classifier.assessStoredEncounter(encounter(null, "encountertypes.lab-results")).module);
		assertEquals(ModuleAccess.IMMUNIZATION, classifier.assessStoredEncounter(encounter(null, "encountertypes.immunizations")).module);
		assertTrue(classifier.assessStoredEncounter(encounter(null, "encountertype.consultation")).isUnrelated());
		Encounter unknownForm = encounter(null, "encountertype.anc-initial");
		Form unrecognised = new Form();
		unrecognised.setUuid("unrecognised-historical-form");
		unknownForm.setForm(unrecognised);
		assertTrue(classifier.assessStoredEncounter(unknownForm).ambiguous);
		assertTrue(classifier.assessStoredEncounter(encounter("immunization", "encountertype.anc-initial")).ambiguous);
	}

	@Test public void triageVitalsAndAppointmentsStayExcluded() {
		assertTrue(classifier.assessStoredEncounter(encounter("triage", "encountertype.triage")).excluded);
		assertTrue(classifier.assessStoredEncounter(encounter(null, "encountertype.vitals")).excluded);
		assertTrue(classifier.assessObservation(obs(encounter(null, "encountertype.vitals"), null)).excluded);
		assertTrue(classifier.appointment().excluded);
	}

	@Test public void conceptTextIsNotOwnership() {
		Obs obs = new Obs();
		obs.setValueText("ANC TB Screening");
		assertTrue(classifier.assessObservation(obs).isUnrelated());
		assertEquals("ANC TB Screening", obs.getValueText());
	}

	@Test public void standaloneOrdersSeparateLaboratoryAndPharmacy() {
		assertEquals(ModuleAccess.LABORATORY, classifier.assessOrder(order(false)).module);
		assertEquals(ModuleAccess.PHARMACY, classifier.assessOrder(order(true)).module);
		assertEquals(ModuleAccess.LABORATORY, classifier.assessOrder(new TestOrder()).module);
		assertEquals(ModuleAccess.PHARMACY, classifier.assessOrder(new DrugOrder()).module);
		Order lab = order(false);
		OrderType child = new OrderType();
		child.setUuid("persisted-test-subtype");
		child.setParent(lab.getOrderType());
		lab.setOrderType(child);
		assertEquals(ModuleAccess.LABORATORY, classifier.assessOrder(lab).module);
		child.setParent(child);
		assertTrue(classifier.assessOrder(lab).ambiguous);
		Order unsupported = new Order();
		assertTrue(classifier.assessOrder(unsupported).ambiguous);
		Order conflict = order(true);
		conflict.setOrderType(order(false).getOrderType());
		assertTrue(classifier.assessOrder(conflict).ambiguous);
	}

	@Test public void ancObservationWithALaboratoryOrderIsLaboratory() {
		Obs result = obs(encounter("anc-initial", "encountertype.anc-initial"), order(false));
		assertEquals(ModuleAccess.LABORATORY, classifier.assessObservation(result).module);
		Obs medication = obs(encounter("anc-initial", "encountertype.anc-initial"), order(true));
		assertEquals(ModuleAccess.PHARMACY, classifier.assessObservation(medication).module);
	}

	@Test public void ordersCannotReclassifyVitalsOrTriage() {
		Encounter[] excluded = { encounter(null, "encountertype.vitals"), encounter("triage", "encountertype.triage") };
		for (Encounter e : excluded) {
			assertTrue(classifier.assessObservation(obs(e, null)).excluded);
			assertTrue(classifier.assessObservation(obs(e, order(true))).excluded);
			assertTrue(classifier.assessObservation(obs(e, order(false))).excluded);
		}
	}

	@Test public void selfAndMutualCyclesStayAmbiguousEvenWithOrders() {
		for (boolean drug : new boolean[] { true, false }) {
			Obs self = obs(null, order(drug));
			self.setObsGroup(self);
			assertTrue(classifier.assessObservation(self).ambiguous);
			Obs child = obs(null, order(drug));
			Obs parent = obs(null, order(drug));
			child.setObsGroup(parent);
			parent.setObsGroup(child);
			assertTrue(classifier.assessObservation(child).ambiguous);
		}
	}

	@Test public void conflictingParentAndChildOrdersFailClosedInBothDirections() {
		for (boolean drug : new boolean[] { true, false }) {
			Obs parent = obs(null, order(drug));
			Obs child = obs(null, order(!drug));
			child.setObsGroup(parent);
			assertTrue(classifier.assessObservation(child).ambiguous);
		}
	}

	@Test public void matchingOrdersCannotHideConflictingEncounters() {
		Obs parent = obs(encounter("immunization", "encountertype.consultation"), order(true));
		Obs child = obs(encounter("anc-initial", "encountertype.anc-initial"), order(true));
		child.setObsGroup(parent);
		assertTrue(classifier.assessObservation(child).ambiguous);
		Obs labOnPharmacy = obs(encounter(null, "encountertypes.lab-results"), order(true));
		assertTrue(classifier.assessObservation(labOnPharmacy).ambiguous);
	}

	@Test public void excludedGroupProvenanceWinsOverAChildOrder() {
		Obs parent = obs(encounter(null, "encountertype.vitals"), null);
		Obs child = obs(null, order(false));
		child.setObsGroup(parent);
		assertTrue(classifier.assessObservation(child).excluded);
		parent.setObsGroup(child);
		assertTrue(classifier.assessObservation(child).ambiguous);
	}

	@Test public void aChildWithoutItsOwnEvidenceInheritsTheParentModule() {
		Obs parent = obs(encounter("immunization", "encountertype.consultation"), null);
		Obs child = new Obs();
		child.setObsGroup(parent);
		assertEquals(ModuleAccess.IMMUNIZATION, classifier.assessObservation(child).module);
		child.setEncounter(encounter("anc-initial", "encountertype.anc-initial"));
		assertTrue(classifier.assessObservation(child).ambiguous);
	}

	@Test public void dispenseRequiresAPharmacyOrder() {
		assertEquals(ModuleAccess.PHARMACY, classifier.assessDispense(order(true)).module);
		assertTrue(classifier.assessDispense(order(false)).ambiguous);
		assertTrue(classifier.assessDispense(null).ambiguous);
	}
}
