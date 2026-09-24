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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/** Inputs shaped as dbsync marshals a model and as the JDBC driver returns a row. */
public class RecordComparisonTest {

	private static final String CREATOR = "1c3db49d-440a-11e6-a65c-00e04c680037";

	private static final String EDITOR = "a4b0e5b2-6e3f-4a36-9c8e-1b2b0ad6b8a1";

	private final RecordComparison.References users = new RecordComparison.References() {

		@Override
		public String uuidOf(String column, Object id) {
			return Integer.valueOf(1).equals(id) ? CREATOR : Integer.valueOf(7).equals(id) ? EDITOR : null;
		}
	};

	private static String offset(LocalDateTime local) {
		return local.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString();
	}

	private Map<String, Object> facility() {
		Map<String, Object> model = new LinkedHashMap<String, Object>();
		model.put("uuid", "5b0f1c2e-0a3f-4a8e-9a55-3f1f7c0e2d11");
		model.put("gender", "F");
		model.put("birthdate", "1990-04-01");
		model.put("birthdateEstimated", false);
		model.put("creatorUuid", "org.openmrs.eip.dbsync.entity.light.UserLight(" + CREATOR + ")");
		model.put("changedByUuid", "org.openmrs.eip.dbsync.entity.light.UserLight(" + CREATOR + ")");
		model.put("dateChanged", offset(LocalDateTime.of(2026, 9, 20, 8, 30, 15)));
		model.put("causeOfDeathNonCoded", null);
		model.put("facilityOnlyField", "x");
		return model;
	}

	private Map<String, Object> central() {
		Map<String, Object> row = new LinkedHashMap<String, Object>();
		row.put("person_id", 12);
		row.put("uuid", "5b0f1c2e-0a3f-4a8e-9a55-3f1f7c0e2d11");
		row.put("gender", "M");
		row.put("birthdate", Date.valueOf("1990-04-01"));
		row.put("birthdate_estimated", 1);
		row.put("creator", 1);
		row.put("changed_by", 7);
		row.put("date_changed", Timestamp.valueOf(LocalDateTime.of(2026, 9, 20, 8, 30, 15, 500)));
		row.put("cause_of_death_non_coded", null);
		return row;
	}

	private static Map<String, Object> field(List<Map<String, Object>> fields, String name) {
		for (Map<String, Object> field : fields) {
			if (name.equals(field.get("field"))) {
				return field;
			}
		}
		throw new AssertionError("no field " + name);
	}

	@Test
	public void compare_shouldFlagOnlyTheFieldsThatDiffer() {
		List<Map<String, Object>> fields = RecordComparison.compare(facility(), central(), users);

		assertEquals(9, fields.size());
		assertFalse((Boolean) field(fields, "uuid").get("differs"));
		assertTrue((Boolean) field(fields, "gender").get("differs"));
		assertEquals("F", field(fields, "gender").get("facility"));
		assertEquals("M", field(fields, "gender").get("central"));
		assertFalse((Boolean) field(fields, "birthdate").get("differs"));
		assertFalse((Boolean) field(fields, "causeOfDeathNonCoded").get("differs"));
	}

	@Test
	public void compare_shouldReadATinyintAsTheBooleanTheModelCarries() {
		Map<String, Object> estimated = field(RecordComparison.compare(facility(), central(), users), "birthdateEstimated");

		assertEquals("false", estimated.get("facility"));
		assertEquals("true", estimated.get("central"));
		assertTrue((Boolean) estimated.get("differs"));
	}

	@Test
	public void compare_shouldResolveReferencesToUuidsOnBothSides() {
		List<Map<String, Object>> fields = RecordComparison.compare(facility(), central(), users);

		assertEquals(CREATOR, field(fields, "creatorUuid").get("facility"));
		assertEquals(CREATOR, field(fields, "creatorUuid").get("central"));
		assertFalse((Boolean) field(fields, "creatorUuid").get("differs"));
		assertEquals(EDITOR, field(fields, "changedByUuid").get("central"));
		assertTrue((Boolean) field(fields, "changedByUuid").get("differs"));
	}

	@Test
	public void compare_shouldCompareDatetimesAsTheSameInstantToTheSecond() {
		Map<String, Object> changed = field(RecordComparison.compare(facility(), central(), users), "dateChanged");

		assertEquals("2026-09-20 08:30:15", changed.get("facility"));
		assertEquals("2026-09-20 08:30:15", changed.get("central"));
		assertFalse((Boolean) changed.get("differs"));
	}

	@Test
	public void compare_shouldShowAFieldWithNoColumnWithoutComparingIt() {
		Map<String, Object> extra = field(RecordComparison.compare(facility(), central(), users), "facilityOnlyField");

		assertFalse((Boolean) extra.get("compared"));
		assertFalse((Boolean) extra.get("differs"));
		assertNull(extra.get("central"));
	}

	@Test
	public void compare_shouldShowEveryFieldUncomparedWhenCentralHasNoRecord() {
		for (Map<String, Object> field : RecordComparison.compare(facility(), null, users)) {
			assertFalse((Boolean) field.get("compared"));
			assertNull(field.get("central"));
		}
	}

	@Test
	public void tableOf_shouldMapDbsyncModelClassesToTheirTables() {
		assertEquals("person", SyncConflictTables.tableOf("org.openmrs.eip.dbsync.model.PersonModel"));
		assertEquals("obs", SyncConflictTables.tableOf("org.openmrs.eip.dbsync.model.ObservationModel"));
		assertEquals("conditions", SyncConflictTables.tableOf("org.openmrs.eip.dbsync.model.ConditionModel"));
		assertNull(SyncConflictTables.tableOf("org.openmrs.eip.dbsync.model.ConceptModel"));
		assertNull(SyncConflictTables.tableOf(null));
	}

	@Test
	public void parentOf_shouldNameTheTableThatHoldsTheUuid() {
		assertEquals("person", SyncConflictTables.parentOf("patient")[0]);
		assertEquals("orders", SyncConflictTables.parentOf("drug_order")[0]);
		assertNull(SyncConflictTables.parentOf("obs"));
	}

	@Test
	public void compare_shouldReadAPatientsOwnAuditFieldsFromItsPrefixedColumns() {
		Map<String, Object> facility = new LinkedHashMap<String, Object>();
		facility.put("creatorUuid", "UserLight(" + CREATOR + ")");
		facility.put("patientCreatorUuid", "UserLight(" + EDITOR + ")");
		facility.put("patientVoided", false);
		Map<String, Object> central = new LinkedHashMap<String, Object>();
		central.put("creator", 1);
		central.put("patient_creator", 7);
		central.put("patient_voided", 0);

		List<Map<String, Object>> fields = RecordComparison.compare(facility, central, users);

		assertEquals(CREATOR, field(fields, "creatorUuid").get("central"));
		assertEquals(EDITOR, field(fields, "patientCreatorUuid").get("central"));
		assertFalse((Boolean) field(fields, "patientVoided").get("differs"));
	}

	@Test
	public void snakeCase_shouldMatchOpenmrsColumnNames() {
		assertEquals("birthdate_estimated", RecordComparison.snakeCase("birthdateEstimated"));
		assertEquals("cause_of_death_non_coded", RecordComparison.snakeCase("causeOfDeathNonCoded"));
		assertEquals("gender", RecordComparison.snakeCase("gender"));
	}
}
