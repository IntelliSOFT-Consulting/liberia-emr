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

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.OrderType;
import org.openmrs.TestOrder;
import org.openmrs.module.liberiaemr.ContentUuids;

/**
 * Ownership from server-owned form, encounter type, and order-type ancestry.
 * Concept values are not evidence. Triage, Vitals, and appointments stay outside the model.
 */
public final class ModuleRecordClassifier {
	public static final class Ownership {
		public final ModuleAccess module;
		public final boolean excluded;
		public final boolean ambiguous;

		private Ownership(ModuleAccess module, boolean excluded, boolean ambiguous) {
			this.module = module;
			this.excluded = excluded;
			this.ambiguous = ambiguous;
		}

		public static Ownership protectedModule(ModuleAccess module) { return new Ownership(module, false, false); }
		public static Ownership excluded() { return new Ownership(null, true, false); }
		public static Ownership ambiguous() { return new Ownership(null, false, true); }
		public static Ownership unrelated() { return new Ownership(null, false, false); }
		public boolean isUnrelated() { return module == null && !excluded && !ambiguous; }
	}

	private static final class FormRule {
		final ModuleAccess module;
		final String encounterType;
		FormRule(ModuleAccess module, String encounterType) {
			this.module = module;
			this.encounterType = encounterType;
		}
	}

	private final Map<String, ModuleAccess> dedicatedTypes = new HashMap<>();
	private final Map<String, FormRule> forms = new HashMap<>();
	private final Set<String> excludedTypes = new HashSet<>();
	private final String triageForm;

	public ModuleRecordClassifier() {
		triageForm = uuid("form.triage");
		excludedTypes.add(uuid("encountertype.triage"));
		excludedTypes.add(uuid("encountertype.vitals"));
		type(ModuleAccess.TB_SCREENING, "tb-screening");
		type(ModuleAccess.ANC, "anc", "anc-initial", "anc-followup");
		type(ModuleAccess.PNC, "pnc", "mch-pnc");
		type(ModuleAccess.FAMILY_PLANNING, "family-planning", "mch-family-planning");
		type(ModuleAccess.LABOR_AND_DELIVERY, "labor-delivery", "labour-admission", "delivery", "partograph");
		dedicatedTypes.put(uuid("encountertypes.lab-results"), ModuleAccess.LABORATORY);
		dedicatedTypes.put(uuid("encountertypes.immunizations"), ModuleAccess.IMMUNIZATION);
		form(ModuleAccess.TB_SCREENING, "tb-screening", "tb-screening");
		form(ModuleAccess.GENERAL_CONSULTATION, "opd-consultation", "consultation");
		form(ModuleAccess.ANC, "anc-initial", "anc-initial");
		form(ModuleAccess.ANC, "anc-followup", "anc-followup");
		form(ModuleAccess.ANC, "anc-national", "consultation");
		form(ModuleAccess.PNC, "pnc-visit", "mch-pnc");
		form(ModuleAccess.PNC, "newborn-pnc", "mch-pnc");
		form(ModuleAccess.PNC, "pnc-national", "consultation");
		form(ModuleAccess.FAMILY_PLANNING, "family-planning", "mch-family-planning");
		form(ModuleAccess.FAMILY_PLANNING, "family-planning-national", "consultation");
		form(ModuleAccess.IMMUNIZATION, "immunization", "consultation");
		form(ModuleAccess.IMMUNIZATION, "aefi", "consultation");
		for (String form : new String[] { "first-and-second-stage-of-labor-and-delivery", "partograph",
		        "third-stage-of-labor-and-delivery", "fourth-stage-monitoring-for-woman-and-baby" }) {
			form(ModuleAccess.LABOR_AND_DELIVERY, form, "labor-delivery");
		}
	}

	private static String uuid(String key) { return ContentUuids.get("var." + key + ".uuid"); }

	private void type(ModuleAccess module, String... names) {
		for (String name : names) { dedicatedTypes.put(uuid("encountertype." + name), module); }
	}

	private void form(ModuleAccess module, String name, String encounterType) {
		forms.put(uuid("form." + name), new FormRule(module, uuid("encountertype." + encounterType)));
	}

	/** Appointments are outside this model. This is not a grant. */
	public Ownership appointment() { return Ownership.excluded(); }

	/**
	 * When {@code serverTypeUuid} is set it is the type stored with the form, not a second label.
	 * A mismatch with {@code submittedTypeUuid} is untrusted.
	 */
	public Ownership assessEncounterIdentity(String formUuid, String serverTypeUuid, String submittedTypeUuid) {
		if (serverTypeUuid != null && submittedTypeUuid != null && !serverTypeUuid.equals(submittedTypeUuid)) {
			FormRule rule = formUuid == null ? null : forms.get(formUuid);
			if (rule == null && excludedTypes.contains(serverTypeUuid) && excludedTypes.contains(submittedTypeUuid)) {
				return Ownership.excluded();
			}
			return Ownership.ambiguous();
		}
		String type = serverTypeUuid != null ? serverTypeUuid : submittedTypeUuid;
		if (type == null) { return Ownership.ambiguous(); }
		FormRule rule = formUuid == null ? null : forms.get(formUuid);
		if (excludedTypes.contains(type)) {
			return rule == null ? Ownership.excluded() : Ownership.ambiguous();
		}
		if (triageForm.equals(formUuid)) { return Ownership.ambiguous(); }
		if (rule != null) {
			return rule.encounterType.equals(type) ? Ownership.protectedModule(rule.module) : Ownership.ambiguous();
		}
		if (formUuid != null) {
			return dedicatedTypes.containsKey(type) ? Ownership.ambiguous() : Ownership.unrelated();
		}
		ModuleAccess dedicated = dedicatedTypes.get(type);
		return dedicated == null ? Ownership.unrelated() : Ownership.protectedModule(dedicated);
	}

	public Ownership assessStoredEncounter(Encounter encounter) {
		if (encounter == null || encounter.getEncounterType() == null || encounter.getEncounterType().getUuid() == null) {
			return Ownership.ambiguous();
		}
		String form = encounter.getForm() == null ? null : encounter.getForm().getUuid();
		String type = encounter.getEncounterType().getUuid();
		return assessEncounterIdentity(form, type, type);
	}

	/** A type that is neither Drug nor Test is unrelated. Conflicting ancestry is ambiguous. */
	public Ownership assessOrder(Order order) {
		if (order == null) { return Ownership.ambiguous(); }
		// REST binds a TestOrder or DrugOrder before OpenMRS assigns its order type inside save.
		if (order.getOrderType() == null) {
			if (order instanceof DrugOrder) { return Ownership.protectedModule(ModuleAccess.PHARMACY); }
			if (order instanceof TestOrder) { return Ownership.protectedModule(ModuleAccess.LABORATORY); }
			return Ownership.ambiguous();
		}
		Set<String> visited = new HashSet<>();
		boolean drug = false;
		boolean test = false;
		for (OrderType type = order.getOrderType(); type != null; type = type.getParent()) {
			if (type.getUuid() == null || !visited.add(type.getUuid())) { return Ownership.ambiguous(); }
			drug |= OrderType.DRUG_ORDER_TYPE_UUID.equals(type.getUuid());
			test |= OrderType.TEST_ORDER_TYPE_UUID.equals(type.getUuid());
		}
		if ((drug && order instanceof TestOrder) || (test && order instanceof DrugOrder) || (drug && test)) {
			return Ownership.ambiguous();
		}
		if (drug) { return Ownership.protectedModule(ModuleAccess.PHARMACY); }
		if (test) { return Ownership.protectedModule(ModuleAccess.LABORATORY); }
		return Ownership.unrelated();
	}

	/**
	 * Walks the in-memory group. A cycle, a broken parent, or conflicting encounter or order
	 * provenance is ambiguous. Excluded encounter provenance wins over an attached order.
	 */
	public Ownership assessObservation(Obs obs) {
		if (obs == null) { return Ownership.ambiguous(); }
		return walk(obs, new HashSet<Obs>(), new HashSet<ModuleAccess>());
	}

	private Ownership walk(Obs obs, Set<Obs> visited, Set<ModuleAccess> contexts) {
		if (obs == null || !visited.add(obs) || visited.size() > 100) { return Ownership.ambiguous(); }
		Ownership parent = null;
		if (obs.getObsGroup() != null) {
			parent = walk(obs.getObsGroup(), visited, contexts);
			if (parent.ambiguous) { return Ownership.ambiguous(); }
		}
		Ownership encounter = obs.getEncounter() == null ? null : assessStoredEncounter(obs.getEncounter());
		if (obs.getEncounter() != null && (encounter == null || encounter.ambiguous)) { return Ownership.ambiguous(); }
		if ((encounter != null && encounter.excluded) || (parent != null && parent.excluded)) { return Ownership.excluded(); }
		if (encounter != null && encounter.module != null) {
			contexts.add(encounter.module);
			if (contexts.size() > 1) { return Ownership.ambiguous(); }
		}
		Ownership direct = encounter;
		if (obs.getOrder() != null) {
			Ownership order = assessOrder(obs.getOrder());
			if (order.ambiguous) { return Ownership.ambiguous(); }
			if (direct != null && (direct.module == ModuleAccess.LABORATORY || direct.module == ModuleAccess.PHARMACY)
			        && order.module != null && direct.module != order.module) {
				return Ownership.ambiguous();
			}
			if (order.module != null) { direct = order; }
		}
		if (parent == null) { return direct == null ? Ownership.unrelated() : direct; }
		if (obs.getEncounter() == null && obs.getOrder() == null) { return parent; }
		if (direct == null || direct.module == null || parent.module == null || direct.module != parent.module) {
			return Ownership.ambiguous();
		}
		return direct;
	}

	/** A dispense is pharmacy only when its linked order is a drug order. */
	public Ownership assessDispense(Order drugOrder) {
		Ownership order = assessOrder(drugOrder);
		return order.module == ModuleAccess.PHARMACY ? order : Ownership.ambiguous();
	}
}
