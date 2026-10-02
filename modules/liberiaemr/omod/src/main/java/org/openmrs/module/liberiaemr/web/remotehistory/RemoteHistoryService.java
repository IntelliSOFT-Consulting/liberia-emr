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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.openmrs.Allergy;
import org.openmrs.Concept;
import org.openmrs.Condition;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.Location;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.OrderType;
import org.openmrs.Patient;
import org.openmrs.PatientProgram;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.ContentUuids;
import org.openmrs.module.liberiaemr.identity.IdentityService;
import org.openmrs.util.PrivilegeConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Loads one patient's ADR-scoped history at central and hands it to {@link RemoteHistoryAssembler}
 * (LE-382). It only reads. The caller holds View Remote History; the reads below run under proxy
 * privileges for exactly the data the scope covers, so the facility's service account needs no
 * clinical privileges of its own.
 */
@Component("liberiaemr.RemoteHistoryService")
public class RemoteHistoryService {

	/** Comma-separated concept UUIDs the MOH names as sensitive; empty until it names any. */
	public static final String GP_EXCLUDED_CONCEPTS = "liberiaemr.remoteHistory.excludedConceptUuids";

	private static final Logger log = LoggerFactory.getLogger(RemoteHistoryService.class);

	private static final List<String> READ_PRIVILEGES = Arrays.asList(PrivilegeConstants.GET_PATIENTS,
	    PrivilegeConstants.GET_PATIENT_IDENTIFIERS, PrivilegeConstants.GET_PERSONS, PrivilegeConstants.GET_ALLERGIES,
	    PrivilegeConstants.GET_CONDITIONS, PrivilegeConstants.GET_ORDERS, PrivilegeConstants.GET_ORDER_TYPES,
	    PrivilegeConstants.GET_CARE_SETTINGS, PrivilegeConstants.GET_PROGRAMS, PrivilegeConstants.GET_PATIENT_PROGRAMS,
	    PrivilegeConstants.GET_ENCOUNTERS, PrivilegeConstants.GET_ENCOUNTER_TYPES, PrivilegeConstants.GET_VISITS,
	    PrivilegeConstants.GET_OBS, PrivilegeConstants.GET_CONCEPTS, PrivilegeConstants.GET_LOCATIONS,
	    PrivilegeConstants.GET_GLOBAL_PROPERTIES);

	@Autowired
	private IdentityService identityService;

	/**
	 * @param patientUuid the patient asked about
	 * @param requestingFacilityUuid the asking facility's location (its records are left out), or
	 *            null
	 */
	public ObjectNode historyFor(String patientUuid, String requestingFacilityUuid) {
		for (String privilege : READ_PRIVILEGES) {
			Context.addProxyPrivilege(privilege);
		}
		try {
			RemoteHistoryAssembler assembler = new RemoteHistoryAssembler(
			        new FacilityResolver(ContentUuids.get(ContentUuids.LOCATION_TAG_HEALTH_FACILITY)), scope());
			List<RemoteHistoryAssembler.Record> records = new ArrayList<RemoteHistoryAssembler.Record>();
			for (String uuid : linkedRecords(patientUuid)) {
				Patient patient = Context.getPatientService().getPatientByUuid(uuid);
				if (patient != null && !patient.getVoided()) {
					records.add(load(patient));
				}
			}
			Location requesting = requestingFacilityUuid == null ? null
			        : Context.getLocationService().getLocationByUuid(requestingFacilityUuid);
			return assembler.assemble(patientUuid, records, requesting, new Date());
		}
		finally {
			for (String privilege : READ_PRIVILEGES) {
				Context.removeProxyPrivilege(privilege);
			}
		}
	}

	/** The patient and every record linked to the same CPI; just the patient without one. */
	private Set<String> linkedRecords(String patientUuid) {
		Set<String> uuids = new LinkedHashSet<String>();
		uuids.add(patientUuid);
		try {
			Object records = identityService.resolve(patientUuid).get("records");
			if (records instanceof List) {
				for (Object record : (List<?>) records) {
					Object linked = ((Map<?, ?>) record).get("patientUuid");
					if (linked != null) {
						uuids.add(linked.toString());
					}
				}
			}
		}
		catch (IdentityService.NotFoundException e) {
			// No CPI yet, or no identity service on this server: the record on its own.
			log.debug("No CPI for {}: {}", patientUuid, e.getMessage());
		}
		return uuids;
	}

	private RemoteHistoryAssembler.Record load(Patient patient) {
		RemoteHistoryAssembler.Record record = new RemoteHistoryAssembler.Record(patient);
		for (Allergy allergy : Context.getPatientService().getAllergies(patient)) {
			if (!allergy.getVoided()) {
				record.allergies.add(allergy);
			}
		}
		for (Condition condition : Context.getConditionService().getActiveConditions(patient)) {
			record.activeConditions.add(condition);
		}
		OrderType drugOrders = Context.getOrderService().getOrderTypeByUuid(OrderType.DRUG_ORDER_TYPE_UUID);
		for (Order order : Context.getOrderService().getActiveOrders(patient, drugOrders, null, null)) {
			if (order instanceof DrugOrder) {
				record.activeDrugOrders.add((DrugOrder) order);
			}
		}
		Concept immunizationHistory = Context.getConceptService()
		        .getConceptByUuid(ContentUuids.get("var.concept.ciel.immunization-history.uuid"));
		if (immunizationHistory != null) {
			for (Obs obs : Context.getObsService().getObservationsByPersonAndConcept(patient, immunizationHistory)) {
				if (!obs.getVoided() && obs.getObsGroup() == null) {
					record.immunizations.add(obs);
				}
			}
		}
		for (PatientProgram programme : Context.getProgramWorkflowService().getPatientPrograms(patient, null, null, null,
		    null, null, false)) {
			record.programmes.add(programme);
		}
		record.encounters.addAll(Context.getEncounterService().getEncountersByPatient(patient));
		return record;
	}

	private RemoteHistoryAssembler.Scope scope() {
		RemoteHistoryAssembler.Scope scope = new RemoteHistoryAssembler.Scope();
		scope.programmeUuids = new HashSet<String>(Arrays.asList(ContentUuids.get("var.program.anc.uuid"),
		    ContentUuids.get("var.program.labour-delivery.uuid"), ContentUuids.get("var.program.pnc.uuid"),
		    ContentUuids.get("var.program.family-planning.uuid")));
		scope.ancEncounterTypeUuids = new HashSet<String>(Arrays.asList(
		    ContentUuids.get("var.encountertype.anc-initial.uuid"), ContentUuids.get("var.encountertype.anc-followup.uuid")));
		scope.gestationalAgeConceptUuid = ContentUuids.get("var.concept.national.gestational-age-weeks.uuid");
		scope.nextContactConceptUuid = ContentUuids.get("var.concept.national.scheduled-date-for-next-anc-visit.uuid");
		scope.vaccineConceptUuid = ContentUuids.get("var.concept.ciel.immunizations.uuid");
		scope.vaccinationDateConceptUuid = ContentUuids.get("var.concept.ciel.vaccination-date.uuid");
		scope.excludedConceptUuids = excludedConcepts(
		    Context.getAdministrationService().getGlobalProperty(GP_EXCLUDED_CONCEPTS, ""));
		return scope;
	}

	static Set<String> excludedConcepts(String configured) {
		if (configured == null || configured.trim().isEmpty()) {
			return Collections.emptySet();
		}
		Set<String> uuids = new HashSet<String>();
		for (String uuid : configured.split(",")) {
			if (!uuid.trim().isEmpty()) {
				uuids.add(uuid.trim());
			}
		}
		return uuids;
	}
}
