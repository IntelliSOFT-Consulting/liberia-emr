/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.provider;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;

import org.junit.Before;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.openmrs.Person;
import org.openmrs.Privilege;
import org.openmrs.Provider;
import org.openmrs.Role;
import org.openmrs.User;
import org.openmrs.api.ProviderService;
import org.openmrs.util.PrivilegeConstants;

public class ClinicalProviderAccountTest {

	private ProviderService providers;

	private Person person;

	private User midwife;

	@Before
	public void setUp() {
		providers = mock(ProviderService.class);
		person = new Person();
		midwife = withRole(new User(person), PrivilegeConstants.ADD_ENCOUNTERS);
		midwife.setSystemId("12-3");
		midwife.setUuid("midwife-uuid");
		when(providers.getProvidersByPerson(person, true)).thenReturn(Collections.<Provider> emptyList());
		when(providers.saveProvider(any(Provider.class))).thenAnswer(i -> i.getArgument(0));
	}

	private static User withRole(User user, String privilege) {
		Role role = new Role("Midwife");
		role.addPrivilege(new Privilege(privilege));
		user.addRole(role);
		return user;
	}

	@Test
	public void createsAProviderForTheUsersPersonKeyedBySystemId() {
		Provider created = ClinicalProviderAccount.ensureFor(midwife, providers);

		ArgumentCaptor<Provider> saved = ArgumentCaptor.forClass(Provider.class);
		verify(providers).saveProvider(saved.capture());
		assertSame(saved.getValue(), created);
		assertSame(person, created.getPerson());
		assertEquals("12-3", created.getIdentifier());
	}

	@Test
	public void leavesAPersonWithAnyProviderAloneRetiredIncluded() {
		Provider retired = new Provider();
		retired.setRetired(true);
		when(providers.getProvidersByPerson(person, true)).thenReturn(Collections.singletonList(retired));

		assertNull(ClinicalProviderAccount.ensureFor(midwife, providers));
		verify(providers, never()).saveProvider(any(Provider.class));
	}

	@Test
	public void fallsBackToTheUserUuidWhenTheSystemIdIsTaken() {
		when(providers.getProviderByIdentifier("12-3")).thenReturn(new Provider());

		assertEquals("midwife-uuid", ClinicalProviderAccount.identifier(midwife, providers));
	}

	@Test
	public void checksOnlyUsersWhoCanAddEncounters() {
		assertTrue(ClinicalProviderAccount.needsCheck(midwife));
		assertFalse(ClinicalProviderAccount.needsCheck(withRole(new User(new Person()), "Get Patients")));
		assertFalse(ClinicalProviderAccount.needsCheck(null));

		User retired = withRole(new User(new Person()), PrivilegeConstants.ADD_ENCOUNTERS);
		retired.setRetired(true);
		assertFalse(ClinicalProviderAccount.needsCheck(retired));
	}
}
