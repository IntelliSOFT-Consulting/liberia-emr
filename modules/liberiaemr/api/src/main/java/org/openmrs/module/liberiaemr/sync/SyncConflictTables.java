/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.sync;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** dbsync's TableToSyncEnum: the tables it keeps hashes for, by model class. */
public final class SyncConflictTables {

	private static final Map<String, String> TABLE_BY_MODEL;

	static {
		Map<String, String> tables = new LinkedHashMap<String, String>();
		tables.put("PersonModel", "person");
		tables.put("PatientModel", "patient");
		tables.put("VisitModel", "visit");
		tables.put("EncounterModel", "encounter");
		tables.put("ObservationModel", "obs");
		tables.put("PersonAttributeModel", "person_attribute");
		tables.put("PatientProgramModel", "patient_program");
		tables.put("PatientStateModel", "patient_state");
		tables.put("VisitAttributeModel", "visit_attribute");
		tables.put("EncounterDiagnosisModel", "encounter_diagnosis");
		tables.put("ConditionModel", "conditions");
		tables.put("PersonNameModel", "person_name");
		tables.put("AllergyModel", "allergy");
		tables.put("PersonAddressModel", "person_address");
		tables.put("PatientIdentifierModel", "patient_identifier");
		tables.put("OrderModel", "orders");
		tables.put("DrugOrderModel", "drug_order");
		tables.put("TestOrderModel", "test_order");
		tables.put("RelationshipModel", "relationship");
		tables.put("EncounterProviderModel", "encounter_provider");
		tables.put("OrderGroupModel", "order_group");
		tables.put("PatientProgramAttributeModel", "patient_program_attribute");
		tables.put("UserModel", "users");
		tables.put("ProviderModel", "provider");
		tables.put("DiagnosisAttributeModel", "diagnosis_attribute");
		tables.put("OrderGroupAttributeModel", "order_group_attribute");
		tables.put("OrderAttributeModel", "order_attribute");
		tables.put("ReferralOrderModel", "referral_order");
		tables.put("EntityBasisMapModel", "datafilter_entity_basis_map");
		TABLE_BY_MODEL = Collections.unmodifiableMap(tables);
	}

	/** Tables whose uuid is in a parent table: {parent, parent key, own key}. */
	private static final Map<String, String[]> PARENT_BY_TABLE;
	
	static {
		Map<String, String[]> parents = new LinkedHashMap<String, String[]>();
		parents.put("patient", new String[] { "person", "person_id", "patient_id" });
		parents.put("drug_order", new String[] { "orders", "order_id", "order_id" });
		parents.put("test_order", new String[] { "orders", "order_id", "order_id" });
		parents.put("referral_order", new String[] { "orders", "order_id", "order_id" });
		PARENT_BY_TABLE = Collections.unmodifiableMap(parents);
	}
	
	private SyncConflictTables() {
	}
	
	public static String[] parentOf(String table) {
		return table == null ? null : PARENT_BY_TABLE.get(table);
	}
	
	public static String tableOf(String modelClassName) {
		if (modelClassName == null) {
			return null;
		}
		return TABLE_BY_MODEL.get(modelClassName.substring(modelClassName.lastIndexOf('.') + 1));
	}
}
