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

import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;

public class ModuleEntitlementsTest {
	private static final String[] ROLES = { "Registrar", "Nurse", "Physician Assistant", "Lab Technician", "Pharmacist",
	        "Midwife", "Finance", "Systems Administrator", "Facility in-charge" };

	// Independent transcription of the approved matrix, module rows / role columns.
	private static final String[] MATRIX = { "WRRRRRRWW", "NWRRRRRWW", "NWWNNNNWW", "NNNNNNWWW", "NWWNNWNWW",
	        "NNWWNWNWW", "NWNNNWNWW", "NWWNWWNWW", "NWRNNWNWW", "NWRNNWNWW", "NWNNNWNWW", "RWWRRRRWR" };

	static Map<String, String[]> roles() throws Exception {
		Map<String, String[]> rows = new HashMap<>();
		try (InputStream in = ModuleEntitlementsTest.class.getResourceAsStream("/module-access-content/roles/roles-common.csv")) {
			assertNotNull("Real role CSV must be on test classpath", in);
			BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
			reader.readLine();
			String line;
			while ((line = reader.readLine()) != null) {
				String[] row = line.split(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)", -1);
				assertEquals(6, row.length);
				assertNull("Duplicate role " + row[2], rows.put(row[2], row));
			}
		}
		return rows;
	}

	static Set<String> grants(String role, Map<String, String[]> rows, Set<String> visiting) {
		assertTrue("Inheritance cycle " + role, visiting.add(role));
		String[] row = rows.get(role);
		assertNotNull("Missing exact role " + role, row);
		Set<String> result = new HashSet<>();
		for (String p : row[4].split(";")) { if (!p.trim().isEmpty()) { result.add(p.trim()); } }
		for (String parent : row[5].split(";")) {
			if (!parent.trim().isEmpty()) { result.addAll(grants(parent.trim(), rows, visiting)); }
		}
		visiting.remove(role);
		return result;
	}

	@Test public void configuredEffectiveGrantsMatchAll99CellsIncludingReadAndWrite() throws Exception {
		Map<String, String[]> rows = roles();
		assertEquals(12, ModuleAccess.values().length);
		assertEquals(ModuleAccess.APPOINTMENTS, ModuleAccess.values()[11]);
		assertEquals("Labor & Delivery row", "NWRNNWNWW", MATRIX[8]);
		assertEquals("Appointments row", "RWWRRRRWR", MATRIX[11]);
		for (int r = 0; r < ROLES.length; r++) {
			Set<String> privileges = grants(ROLES[r], rows, new HashSet<String>());
			for (int m = 0; m < MATRIX.length; m++) {
				ModuleAccess module = ModuleAccess.values()[m];
				char cell = MATRIX[m].charAt(r);
				Access expected = cell == 'W' ? Access.WRITE : cell == 'R' ? Access.READ : Access.NONE;
				String label = ROLES[r] + " / " + module;
				assertEquals(label, expected, module.access(privileges));
				assertEquals(label + " read", cell != 'N', module.allows(privileges, Access.READ));
				assertEquals(label + " write", cell == 'W', module.allows(privileges, Access.WRITE));
			}
		}
	}

	@Test public void writeImpliesReadExplicitlyAndReadNeverImpliesWrite() {
		for (ModuleAccess module : Arrays.asList(ModuleAccess.TB_SCREENING, ModuleAccess.LABOR_AND_DELIVERY,
		        ModuleAccess.IMMUNIZATION)) {
			assertTrue(module.allows(module.writePrivileges(), Access.READ));
			assertFalse(module.writePrivileges().containsAll(module.readPrivileges()));
			assertFalse(module.allows(module.readPrivileges(), Access.WRITE));
		}
		for (ModuleAccess module : ModuleAccess.values()) {
			assertFalse(module.allows(Collections.<String>emptySet(), Access.READ));
			assertFalse(module.allows(Collections.<String>emptySet(), Access.WRITE));
			assertFalse(module.allows(module.writePrivileges(), Access.NONE));
			assertEquals(Access.NONE, module.access(null));
		}
	}

	@Test public void registrationAndBillingRequireCompleteBundlesInTheMatrix() {
		for (ModuleAccess module : Arrays.asList(ModuleAccess.REGISTRATION, ModuleAccess.BILLING)) {
			for (String missing : module.writePrivileges()) {
				Set<String> partial = new HashSet<>(module.writePrivileges());
				partial.remove(missing);
				assertFalse(missing, module.allows(partial, Access.WRITE));
			}
		}
		assertFalse(ModuleAccess.REGISTRATION.allows(Collections.singleton("Get Patients"), Access.READ));
		assertFalse(ModuleAccess.BILLING.allows(Collections.singleton("View Cashier Bills"), Access.READ));
	}

	@Test public void financeCanBillAndNurseCannot() throws Exception {
		Map<String, String[]> rows = roles();
		assertTrue(ModuleAccess.BILLING.allows(grants("Finance", rows, new HashSet<String>()), Access.WRITE));
		assertTrue(ModuleAccess.BILLING.allows(grants("Systems Administrator", rows, new HashSet<String>()), Access.WRITE));
		assertTrue(ModuleAccess.BILLING.allows(grants("Facility in-charge", rows, new HashSet<String>()), Access.WRITE));
		assertFalse(ModuleAccess.BILLING.allows(grants("Nurse", rows, new HashSet<String>()), Access.READ));
		assertFalse(ModuleAccess.BILLING.allows(grants("Nurse", rows, new HashSet<String>()), Access.WRITE));
		assertEquals(3, ModuleAccessInstaller.SERVICES.length);
		for (Class<?> service : ModuleAccessInstaller.SERVICES) {
			assertFalse(service.getName(), service.getName().toLowerCase().contains("bill"));
			assertFalse(service.getName(), service.getName().toLowerCase().contains("patient"));
			assertFalse(service.getName(), service.getName().toLowerCase().contains("appointment"));
		}
	}

	@Test public void registrarCanRegisterAndNurseRegistrationIsReadOnly() throws Exception {
		Map<String, String[]> rows = roles();
		assertEquals(Access.WRITE, ModuleAccess.REGISTRATION.access(grants("Registrar", rows, new HashSet<String>())));
		assertEquals(Access.READ, ModuleAccess.REGISTRATION.access(grants("Nurse", rows, new HashSet<String>())));
		assertFalse(grants("Nurse", rows, new HashSet<String>()).contains("Add Patients"));
	}

	@Test public void incompatibleInheritanceIsRemovedWithoutLosingExistingCorePrivileges() throws Exception {
		Map<String, String[]> rows = roles();
		// The Nurse row on main before this change. Clinician and Midwife inherited it.
		Set<String> nurseBefore = new HashSet<>(Arrays.asList("Get Patients", "Get Visits", "Add Visits", "Get Encounters",
		        "Add Encounters", "Edit Encounters", "Get Observations", "Add Observations", "Get Concepts", "Get Forms"));
		Set<String> clinicianBefore = new HashSet<>(nurseBefore);
		clinicianBefore.addAll(Arrays.asList("Get Orders", "Add Orders", "Edit Orders", "Get Order Types", "Get Care Settings",
		        "Get Patient Programs", "Add Patient Programs", "Edit Patient Programs", "Get Diagnoses", "Edit Diagnoses"));
		assertEquals("", rows.get("Clinician")[5]);
		assertEquals(clinicianBefore, grants("Clinician", rows, new HashSet<String>()));
		assertTrue(grants("Nurse", rows, new HashSet<String>()).containsAll(nurseBefore));
		// Every user already has Get Locations through the core Authenticated role; only Records Officer granted it before.
		for (String role : new String[] { "Registrar", "Nurse", "Physician Assistant", "Lab Technician", "Pharmacist", "Midwife",
		        "Finance", "Systems Administrator", "Facility in-charge", "Clinician" }) {
			assertFalse(role, grants(role, rows, new HashSet<String>()).contains("Get Locations"));
		}
		assertEquals("", rows.get("Midwife")[5]);
		Set<String> midwife = grants("Midwife", rows, new HashSet<String>());
		assertTrue(midwife.containsAll(nurseBefore));
		assertTrue(midwife.containsAll(Arrays.asList("Get Patient Programs", "Add Patient Programs", "Edit Patient Programs")));
		for (String role : new String[] { "Registrar", "Physician Assistant", "Finance", "Systems Administrator", "Facility in-charge" }) {
			Set<String> configured = grants(role, rows, new HashSet<String>());
			for (String p : Arrays.asList("Get Encounters", "Add Encounters", "Edit Encounters", "Get Observations", "Add Observations")) {
				assertFalse(role + " unexpectedly gains generic clinical access", configured.contains(p));
			}
		}
	}

	@Test public void formLauncherPrivilegesDoNotGrantGenericClinicalAccess() throws Exception {
		Map<String, String[]> rows = roles();
		String[] supporting = { "Get Visits", "Add Visits", "Get Visit Attribute Types", "Get Forms", "Get Concepts" };
		String[] generic = { "Get Encounters", "Add Encounters", "Edit Encounters", "Get Observations", "Add Observations",
		        "Edit Observations", "Get Orders", "Add Orders", "Edit Orders" };
		for (String role : new String[] { "Physician Assistant", "Systems Administrator", "Facility in-charge" }) {
			Set<String> privileges = grants(role, rows, new HashSet<String>());
			for (String privilege : supporting) {
				assertTrue(role + " " + privilege, privileges.contains(privilege));
			}
			for (String privilege : generic) {
				assertFalse(role + " must not gain " + privilege, privileges.contains(privilege));
			}
		}
		for (String role : new String[] { "Finance", "Registrar", "Lab Technician", "Pharmacist" }) {
			assertFalse(role, grants(role, rows, new HashSet<String>()).contains("Get Visits"));
		}
	}

	@Test public void queueReadIsLimitedToTheFiveClinicalRoles() throws Exception {
		Map<String, String[]> rows = roles();
		for (String role : new String[] { "Nurse", "Midwife", "Physician Assistant", "Lab Technician", "Pharmacist" }) {
			Set<String> privileges = grants(role, rows, new HashSet<String>());
			assertTrue(role, privileges.contains("Get Queues"));
			assertTrue(role, privileges.contains("Get Queue Entries"));
			for (String write : Arrays.asList("Manage Queues", "Manage Queue Entries", "Purge Queues", "Purge Queue Entries",
			        "Get Queue Rooms", "Manage Queue Rooms")) {
				assertFalse(role + " " + write, privileges.contains(write));
			}
		}
		for (String role : new String[] { "Registrar", "Finance", "Systems Administrator", "Facility in-charge", "Clinician" }) {
			Set<String> privileges = grants(role, rows, new HashSet<String>());
			for (String privilege : Arrays.asList("Get Queues", "Get Queue Entries", "Manage Queues", "Manage Queue Entries",
			        "Get Queue Rooms", "Manage Queue Rooms", "Purge Queues", "Purge Queue Entries")) {
				assertFalse(role + " " + privilege, privileges.contains(privilege));
			}
		}
		Set<String> nurse = grants("Nurse", rows, new HashSet<String>());
		assertTrue(nurse.contains("Write Labor and Delivery"));
		assertFalse(nurse.contains("Get Users"));
		assertFalse(nurse.contains("Edit Users"));
	}

	@Test public void conceptSourcesSupportPharmacyMedicationRequestReadsOnly() throws Exception {
		Map<String, String[]> rows = roles();
		for (String role : new String[] { "Nurse", "Physician Assistant", "Pharmacist", "Midwife", "Systems Administrator",
		        "Facility in-charge" }) {
			assertTrue(role, grants(role, rows, new HashSet<String>()).contains("Get Concept Sources"));
		}
		for (String role : new String[] { "Registrar", "Lab Technician", "Finance" }) {
			assertFalse(role, grants(role, rows, new HashSet<String>()).contains("Get Concept Sources"));
		}
	}

	@Test public void appointmentsReadNeverIncludesManageAndDoesNotCountAsClinicalRead() throws Exception {
		Map<String, String[]> rows = roles();
		String[] readOnly = { "Registrar", "Lab Technician", "Pharmacist", "Midwife", "Finance", "Facility in-charge" };
		String[] write = { "Nurse", "Physician Assistant", "Systems Administrator" };
		String[] notGranted = { "Manage Own Appointments", "Manage Appointment Services", "Manage Appointment Specialities",
		        "Reset Appointment Status", "Appointments: Invite Providers", "app:appointments:manageServices",
		        "app:appointments:manageServiceAvailability" };
		for (String role : readOnly) {
			Set<String> privileges = grants(role, rows, new HashSet<String>());
			assertEquals(role, Access.READ, ModuleAccess.APPOINTMENTS.access(privileges));
			assertFalse(role, privileges.contains("Manage Appointments"));
			for (String privilege : notGranted) {
				assertFalse(role + " " + privilege, privileges.contains(privilege));
			}
		}
		for (String role : write) {
			Set<String> privileges = grants(role, rows, new HashSet<String>());
			assertEquals(role, Access.WRITE, ModuleAccess.APPOINTMENTS.access(privileges));
			assertTrue(role, privileges.contains("Manage Appointments"));
			assertTrue(role, privileges.contains("View Appointments"));
			assertTrue(role, privileges.contains("View Appointment Services"));
			for (String privilege : notGranted) {
				assertFalse(role + " " + privilege, privileges.contains(privilege));
			}
		}
		assertFalse(ModulePrivileges.anyClinicalRead(grants("Registrar", rows, new HashSet<String>())));
		assertFalse(ModulePrivileges.anyClinicalRead(ModuleAccess.APPOINTMENTS.readPrivileges()));
		assertFalse(ModuleAccess.APPOINTMENTS.allows(ModuleAccess.APPOINTMENTS.readPrivileges(), Access.WRITE));
	}

	@Test public void onlyTheTwelveApprovedPrivilegesAreCreated() throws Exception {
		Set<String> expected = new HashSet<>(Arrays.asList("Read TB Screening", "Write TB Screening", "Manage General Consultation",
		        "Manage ANC", "Manage Laboratory", "Manage PNC", "Manage Pharmacy", "Read Labor and Delivery",
		        "Write Labor and Delivery", "Read Immunization", "Write Immunization", "Manage Family Planning"));
		Set<String> actual = new HashSet<>();
		try (InputStream in = getClass().getResourceAsStream("/module-access-content/privileges/privileges-module-access-common.csv")) {
			assertNotNull(in);
			BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
			reader.readLine();
			String line;
			while ((line = reader.readLine()) != null) { assertTrue(actual.add(line.split(",", -1)[2])); }
		}
		assertEquals(expected, actual);
	}
}
