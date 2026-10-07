/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotesearch;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Set;

import org.openmrs.BaseOpenmrsData;
import org.openmrs.Concept;
import org.openmrs.Location;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientIdentifierType;
import org.openmrs.PersonAddress;
import org.openmrs.PersonName;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Builds the patient shell from central's full patient representation (design: remote import sync
 * isolation, Architecture §1). Only person, patient, names, addresses and identifiers are written,
 * and every row keeps central's UUID and preferred flag, so the shell reaches central through sync
 * as no-op upserts of rows central already has. Nothing clinical is copied.
 * <p>
 * Lookups go through {@link Lookups} so the rules can be unit-tested without an OpenMRS context.
 */
class PatientShellBuilder {

	private static final Logger log = LoggerFactory.getLogger(PatientShellBuilder.class);

	/** Local metadata and checks the builder needs. */
	interface Lookups {

		PatientIdentifierType identifierType(String uuid);

		Location location(String uuid);

		/** Used when an identifier's location is not defined here. May return null. */
		Location fallbackLocation();

		Concept concept(String uuid);

		/** Whether a patient other than {@code patientUuid} already holds this identifier value. */
		boolean heldByAnotherPatient(PatientIdentifierType type, String value, String patientUuid);
	}

	private final Lookups lookups;

	PatientShellBuilder(Lookups lookups) {
		this.lookups = lookups;
	}

	/** A new, unsaved patient shell for central's patient. */
	Patient build(JsonNode remotePatient) throws Exception {
		JsonNode person = remotePatient.path("person");
		if (person.isMissingNode()) {
			throw new IllegalStateException("Central patient has no person record");
		}
		Patient patient = new Patient();
		patient.setUuid(remotePatient.path("uuid").asText());
		applyAudit(patient, remotePatient);
		patient.setGender(person.path("gender").asText());
		String birthdate = person.path("birthdate").asText("");
		if (!birthdate.isEmpty()) {
			patient.setBirthdate(parseDate(birthdate));
		}
		patient.setBirthdateEstimated(person.path("birthdateEstimated").asBoolean(false));
		applyDeath(patient, person);
		reconcile(patient, remotePatient);
		return patient;
	}

	/**
	 * Adds every central name, address and identifier the patient does not hold yet (matched by
	 * UUID). Rows already present are left alone, so repeating an import adds nothing twice.
	 *
	 * @return whether anything was added
	 */
	boolean reconcile(Patient patient, JsonNode remotePatient) throws Exception {
		JsonNode person = remotePatient.path("person");
		boolean added = false;

		Set<String> names = new HashSet<String>();
		for (PersonName name : patient.getNames()) {
			names.add(name.getUuid());
		}
		for (JsonNode node : array(person.path("names"))) {
			if (skip(node, names)) {
				continue;
			}
			PersonName name = new PersonName();
			name.setUuid(node.path("uuid").asText());
			name.setGivenName(text(node, "givenName"));
			name.setMiddleName(text(node, "middleName"));
			name.setFamilyName(text(node, "familyName"));
			name.setPreferred(node.path("preferred").asBoolean(false));
			applyAudit(name, node);
			patient.addName(name);
			added = true;
		}

		Set<String> addresses = new HashSet<String>();
		for (PersonAddress address : patient.getAddresses()) {
			addresses.add(address.getUuid());
		}
		for (JsonNode node : array(person.path("addresses"))) {
			if (skip(node, addresses)) {
				continue;
			}
			PersonAddress address = new PersonAddress();
			address.setUuid(node.path("uuid").asText());
			address.setAddress1(text(node, "address1"));
			address.setAddress2(text(node, "address2"));
			address.setCityVillage(text(node, "cityVillage"));
			address.setStateProvince(text(node, "stateProvince"));
			address.setCountyDistrict(text(node, "countyDistrict"));
			address.setCountry(text(node, "country"));
			address.setPostalCode(text(node, "postalCode"));
			address.setPreferred(node.path("preferred").asBoolean(false));
			applyAudit(address, node);
			patient.addAddress(address);
			added = true;
		}

		Set<String> identifiers = new HashSet<String>();
		for (PatientIdentifier identifier : patient.getIdentifiers()) {
			identifiers.add(identifier.getUuid());
		}
		for (JsonNode node : array(remotePatient.path("identifiers"))) {
			if (skip(node, identifiers)) {
				continue;
			}
			PatientIdentifier identifier = identifier(patient, node);
			if (identifier != null) {
				patient.addIdentifier(identifier);
				added = true;
			}
		}
		return added;
	}

	private PatientIdentifier identifier(Patient patient, JsonNode node) {
		String typeUuid = node.path("identifierType").path("uuid").asText("");
		PatientIdentifierType type = lookups.identifierType(typeUuid);
		if (type == null) {
			log.warn("Skipping central identifier of unknown type {}", typeUuid);
			return null;
		}

		// Identifier locations are central's; they usually exist here because the location tree is
		// synced from the MFL. When one does not, the facility's own location keeps the identifier.
		String locationUuid = node.path("location").path("uuid").asText("");
		Location location = locationUuid.isEmpty() ? null : lookups.location(locationUuid);
		if (location == null) {
			location = lookups.fallbackLocation();
		}
		if (location == null) {
			log.warn("Skipping central identifier of type {}: no matching or fallback location", type.getName());
			return null;
		}

		// OpenMRS ID is generated per facility and can repeat across them. A value another local
		// patient holds would clash or blur two people, so the shell goes without it.
		String value = node.path("identifier").asText("");
		if (value.isEmpty() || lookups.heldByAnotherPatient(type, value, patient.getUuid())) {
			log.warn("Skipping central identifier of type {}: empty, or already held by another local patient",
			    type.getName());
			return null;
		}

		PatientIdentifier identifier = new PatientIdentifier();
		identifier.setUuid(node.path("uuid").asText());
		identifier.setIdentifier(value);
		identifier.setIdentifierType(type);
		identifier.setLocation(location);
		identifier.setPreferred(node.path("preferred").asBoolean(false));
		applyAudit(identifier, node);
		return identifier;
	}

	/**
	 * Death comes across with its cause and date, or the import fails: OpenMRS 2.8's person
	 * validator rejects a dead person without a cause.
	 */
	private void applyDeath(Patient patient, JsonNode person) {
		if (!person.path("dead").asBoolean(false)) {
			return;
		}
		patient.setDead(true);
		patient.setDeathDate(parseDateOrNull(person.path("deathDate")));
		patient.setDeathdateEstimated(person.path("deathdateEstimated").asBoolean(false));

		JsonNode cause = person.path("causeOfDeath");
		Concept concept = cause.path("uuid").asText("").isEmpty() ? null : lookups.concept(cause.path("uuid").asText());
		if (concept != null) {
			patient.setCauseOfDeath(concept);
			return;
		}
		String nonCoded = person.path("causeOfDeathNonCoded").asText("").trim();
		if (nonCoded.isEmpty()) {
			// A coded cause this facility does not know: keep its wording rather than lose it.
			nonCoded = cause.path("display").asText("").trim();
		}
		if (nonCoded.isEmpty()) {
			throw new IllegalStateException("Central marks the patient deceased without a cause of death");
		}
		patient.setCauseOfDeathNonCoded(nonCoded);
	}

	private static void applyAudit(BaseOpenmrsData row, JsonNode node) {
		Date created = parseDateOrNull(node.path("auditInfo").path("dateCreated"));
		if (created != null) {
			row.setDateCreated(created);
		}
	}

	/** Voided rows, rows without a UUID and rows already present are not added. */
	private static boolean skip(JsonNode node, Set<String> present) {
		String uuid = node.path("uuid").asText("");
		return node.path("voided").asBoolean(false) || uuid.isEmpty() || present.contains(uuid);
	}

	private static Iterable<JsonNode> array(JsonNode node) {
		return node.isArray() ? node : java.util.Collections.<JsonNode> emptyList();
	}

	private static String text(JsonNode node, String field) {
		JsonNode value = node.path(field);
		return value.isMissingNode() || value.isNull() ? null : value.asText();
	}

	/** Dates as OpenMRS REST returns them ("1990-01-01T00:00:00.000+0000"), or a bare date. */
	static Date parseDate(String value) throws Exception {
		try {
			return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ").parse(value);
		}
		catch (Exception e) {
			return new SimpleDateFormat("yyyy-MM-dd").parse(value.substring(0, Math.min(10, value.length())));
		}
	}

	static Date parseDateOrNull(JsonNode node) {
		String value = node.asText("");
		if (value.isEmpty()) {
			return null;
		}
		try {
			return parseDate(value);
		}
		catch (Exception e) {
			log.warn("Could not read central date '{}'", value);
			return null;
		}
	}
}
