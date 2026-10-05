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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Before;
import org.junit.Test;
import org.openmrs.Concept;
import org.openmrs.Location;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientIdentifierType;
import org.openmrs.PersonAddress;
import org.openmrs.PersonName;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The patient shell rules (design: remote import sync isolation, Architecture §1), against an
 * in-memory stand-in for the local metadata.
 */
public class PatientShellBuilderTest {

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private static final String PATIENT = "aaaaaaaa-0000-0000-0000-000000000001";

	private static final String OPENMRS_ID = "05a29f94-c0ed-11e2-94be-8c13b969e334";

	private static final String HRN = "bbbbbbbb-0000-0000-0000-000000000002";

	private static final String CAREYSBURG = "cccccccc-0000-0000-0000-000000000003";

	private static final String CAUSE = "dddddddd-0000-0000-0000-000000000004";

	private final Map<String, PatientIdentifierType> types = new HashMap<String, PatientIdentifierType>();

	private final Map<String, Location> locations = new HashMap<String, Location>();

	private final Map<String, Concept> concepts = new HashMap<String, Concept>();

	/** "type uuid|value" pairs held by some other local patient */
	private final Set<String> heldElsewhere = new HashSet<String>();

	private Location fallback;

	private PatientShellBuilder builder;

	@Before
	public void setUp() {
		types.put(OPENMRS_ID, type(OPENMRS_ID, "OpenMRS ID"));
		types.put(HRN, type(HRN, "MOH Health Record Number"));
		locations.put(CAREYSBURG, location(CAREYSBURG));
		Concept cause = new Concept();
		cause.setUuid(CAUSE);
		concepts.put(CAUSE, cause);
		fallback = location("eeeeeeee-0000-0000-0000-000000000005");

		builder = new PatientShellBuilder(new PatientShellBuilder.Lookups() {

			@Override
			public PatientIdentifierType identifierType(String uuid) {
				return types.get(uuid);
			}

			@Override
			public Location location(String uuid) {
				return locations.get(uuid);
			}

			@Override
			public Location fallbackLocation() {
				return fallback;
			}

			@Override
			public Concept concept(String uuid) {
				return concepts.get(uuid);
			}

			@Override
			public boolean heldByAnotherPatient(PatientIdentifierType type, String value, String patientUuid) {
				return heldElsewhere.contains(type.getUuid() + "|" + value);
			}
		});
	}

	private static PatientIdentifierType type(String uuid, String name) {
		PatientIdentifierType type = new PatientIdentifierType();
		type.setUuid(uuid);
		type.setName(name);
		return type;
	}

	private static Location location(String uuid) {
		Location location = new Location();
		location.setUuid(uuid);
		return location;
	}

	/** Central's full patient representation, trimmed to what the shell reads. */
	private static String centralPatient(String deathFields) {
		return "{\"uuid\":\"" + PATIENT + "\",\"auditInfo\":{\"dateCreated\":\"2026-03-01T09:00:00.000+0000\"},"
		        + "\"identifiers\":["
		        + "{\"uuid\":\"id-1\",\"identifier\":\"100000Y\",\"preferred\":false,"
		        + "\"identifierType\":{\"uuid\":\"" + OPENMRS_ID + "\"},\"location\":{\"uuid\":\"" + CAREYSBURG + "\"}},"
		        + "{\"uuid\":\"id-2\",\"identifier\":\"HRN-CBG-10001\",\"preferred\":true,"
		        + "\"identifierType\":{\"uuid\":\"" + HRN + "\"},\"location\":{\"uuid\":\"unknown-here\"}},"
		        + "{\"uuid\":\"id-3\",\"identifier\":\"OLD\",\"voided\":true,"
		        + "\"identifierType\":{\"uuid\":\"" + HRN + "\"}}],"
		        + "\"person\":{\"gender\":\"F\",\"birthdate\":\"1990-05-17T00:00:00.000+0000\",\"birthdateEstimated\":false"
		        + deathFields + ","
		        + "\"names\":["
		        + "{\"uuid\":\"name-1\",\"givenName\":\"Kate\",\"familyName\":\"Red\",\"preferred\":false},"
		        + "{\"uuid\":\"name-2\",\"givenName\":\"Katherine\",\"familyName\":\"Red\",\"preferred\":true,"
		        + "\"auditInfo\":{\"dateCreated\":\"2026-04-01T10:00:00.000+0000\"}}],"
		        + "\"addresses\":[{\"uuid\":\"addr-1\",\"cityVillage\":\"Careysburg\",\"country\":\"Liberia\","
		        + "\"preferred\":true}]}}";
	}

	private static JsonNode json(String text) throws Exception {
		return MAPPER.readTree(text);
	}

	// --- every row keeps central's UUID -----------------------------------------------------------

	@Test
	public void everyRowKeepsCentralsUuid() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));

		assertEquals(PATIENT, shell.getUuid());
		Set<String> names = new HashSet<String>();
		for (PersonName name : shell.getNames()) {
			names.add(name.getUuid());
		}
		assertEquals(new HashSet<String>(java.util.Arrays.asList("name-1", "name-2")), names);
		assertEquals("addr-1", shell.getAddresses().iterator().next().getUuid());
		Set<String> identifiers = new HashSet<String>();
		for (PatientIdentifier identifier : shell.getIdentifiers()) {
			identifiers.add(identifier.getUuid());
		}
		assertEquals(new HashSet<String>(java.util.Arrays.asList("id-1", "id-2")), identifiers);
	}

	@Test
	public void voidedRowsAreLeftBehind() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));

		for (PatientIdentifier identifier : shell.getIdentifiers()) {
			assertFalse("OLD".equals(identifier.getIdentifier()));
		}
	}

	@Test
	public void centralsAuditDateIsKept() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");

		assertEquals("2026-03-01", day.format(shell.getDateCreated()));
		for (PersonName name : shell.getNames()) {
			if ("name-2".equals(name.getUuid())) {
				assertEquals("2026-04-01", day.format(name.getDateCreated()));
			}
		}
	}

	// --- preferred flags are central's, never re-derived ------------------------------------------

	@Test
	public void preferredFlagsAreCopiedNotDerived() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));

		int preferredNames = 0;
		for (PersonName name : shell.getNames()) {
			if (name.getPreferred()) {
				preferredNames++;
				assertEquals("name-2", name.getUuid());
			}
		}
		// Central's preferred name is the second one; the first must not also become preferred.
		assertEquals(1, preferredNames);
		for (PatientIdentifier identifier : shell.getIdentifiers()) {
			assertEquals("id-2".equals(identifier.getUuid()), identifier.getPreferred());
		}
	}

	// --- identifiers ------------------------------------------------------------------------------

	@Test
	public void anIdentifierAtALocationUnknownHereUsesTheFacilityLocation() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));

		for (PatientIdentifier identifier : shell.getIdentifiers()) {
			Location expected = "id-1".equals(identifier.getUuid()) ? locations.get(CAREYSBURG) : fallback;
			assertSame(expected, identifier.getLocation());
		}
	}

	@Test
	public void anIdentifierAnotherLocalPatientHoldsIsLeftOut() throws Exception {
		heldElsewhere.add(OPENMRS_ID + "|100000Y");

		Patient shell = builder.build(json(centralPatient("")));

		assertEquals(1, shell.getIdentifiers().size());
		assertEquals("id-2", shell.getIdentifiers().iterator().next().getUuid());
	}

	@Test
	public void anIdentifierOfATypeUnknownHereIsLeftOut() throws Exception {
		types.remove(OPENMRS_ID);

		Patient shell = builder.build(json(centralPatient("")));

		assertEquals(1, shell.getIdentifiers().size());
	}

	// --- death ------------------------------------------------------------------------------------

	@Test
	public void aDeceasedPatientKeepsTheCodedCauseAndDate() throws Exception {
		Patient shell = builder.build(json(centralPatient(",\"dead\":true,\"deathDate\":\"2026-09-01T00:00:00.000+0000\","
		        + "\"causeOfDeath\":{\"uuid\":\"" + CAUSE + "\",\"display\":\"Malaria\"}")));

		assertTrue(shell.getDead());
		assertEquals("2026-09-01", new SimpleDateFormat("yyyy-MM-dd").format(shell.getDeathDate()));
		assertSame(concepts.get(CAUSE), shell.getCauseOfDeath());
		assertNull(shell.getCauseOfDeathNonCoded());
	}

	@Test
	public void aCodedCauseUnknownHereKeepsItsWordingAsNonCoded() throws Exception {
		concepts.clear();

		Patient shell = builder.build(json(centralPatient(
		    ",\"dead\":true,\"causeOfDeath\":{\"uuid\":\"" + CAUSE + "\",\"display\":\"Malaria\"}")));

		assertNull(shell.getCauseOfDeath());
		assertEquals("Malaria", shell.getCauseOfDeathNonCoded());
	}

	@Test
	public void aNonCodedCauseIsKept() throws Exception {
		Patient shell = builder.build(json(centralPatient(",\"dead\":true,\"causeOfDeathNonCoded\":\"Road accident\"")));

		assertEquals("Road accident", shell.getCauseOfDeathNonCoded());
	}

	@Test
	public void aDeathWithoutAnyCauseFailsInsteadOfSavingAnInvalidPerson() throws Exception {
		try {
			builder.build(json(centralPatient(",\"dead\":true")));
			fail("a dead person without a cause must not be built");
		}
		catch (IllegalStateException expected) {
			assertTrue(expected.getMessage().contains("cause of death"));
		}
	}

	@Test
	public void aLivingPatientCarriesNoDeathData() throws Exception {
		Patient shell = builder.build(json(centralPatient("")));

		assertFalse(shell.getDead());
		assertNull(shell.getDeathDate());
		assertNull(shell.getCauseOfDeath());
	}

	// --- repeating an import ----------------------------------------------------------------------

	@Test
	public void reconcilingACompleteShellAddsNothing() throws Exception {
		JsonNode central = json(centralPatient(""));
		Patient shell = builder.build(central);
		int names = shell.getNames().size();
		int addresses = shell.getAddresses().size();
		int identifiers = shell.getIdentifiers().size();

		assertFalse(builder.reconcile(shell, central));
		assertEquals(names, shell.getNames().size());
		assertEquals(addresses, shell.getAddresses().size());
		assertEquals(identifiers, shell.getIdentifiers().size());
	}

	@Test
	public void reconcilingAddsOnlyTheMissingRows() throws Exception {
		JsonNode central = json(centralPatient(""));
		// A shell from an earlier import that lacks name-2 and the address.
		Patient shell = new Patient();
		shell.setUuid(PATIENT);
		PersonName first = new PersonName("Kate", null, "Red");
		first.setUuid("name-1");
		shell.addName(first);

		assertTrue(builder.reconcile(shell, central));
		assertEquals(2, shell.getNames().size());
		assertEquals(1, shell.getAddresses().size());
		assertEquals(2, shell.getIdentifiers().size());
		assertNotNull(shell.getAddresses().iterator().next());
	}

	@Test
	public void aShellsOwnIdentifierDoesNotCountAsHeldByAnother() throws Exception {
		// The lookup is given the shell's UUID, so its own earlier rows never block re-adding.
		final String[] askedFor = new String[1];
		PatientShellBuilder probing = new PatientShellBuilder(new PatientShellBuilder.Lookups() {

			@Override
			public PatientIdentifierType identifierType(String uuid) {
				return types.get(uuid);
			}

			@Override
			public Location location(String uuid) {
				return locations.get(uuid);
			}

			@Override
			public Location fallbackLocation() {
				return fallback;
			}

			@Override
			public Concept concept(String uuid) {
				return null;
			}

			@Override
			public boolean heldByAnotherPatient(PatientIdentifierType type, String value, String patientUuid) {
				askedFor[0] = patientUuid;
				return false;
			}
		});

		probing.build(json(centralPatient("")));

		assertEquals(PATIENT, askedFor[0]);
	}

	@Test
	public void aCentralPatientWithoutAPersonIsRefused() throws Exception {
		try {
			builder.build(json("{\"uuid\":\"" + PATIENT + "\"}"));
			fail("expected a refusal");
		}
		catch (IllegalStateException expected) {
			assertTrue(expected.getMessage().contains("no person"));
		}
	}

	@Test
	public void addressFieldsAreCopied() throws Exception {
		PersonAddress address = builder.build(json(centralPatient(""))).getAddresses().iterator().next();

		assertEquals("Careysburg", address.getCityVillage());
		assertEquals("Liberia", address.getCountry());
		assertTrue(address.getPreferred());
	}
}
